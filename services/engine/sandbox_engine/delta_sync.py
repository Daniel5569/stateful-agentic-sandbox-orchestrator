import hashlib
import json
import re
import shutil
from dataclasses import dataclass
from pathlib import Path

WORKSPACE_REF_PATTERN = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$")
INTERNAL_MANIFEST = ".delta-manifest.json"


@dataclass(frozen=True)
class DeltaResult:
    added: list[str]
    changed: list[str]
    deleted: list[str]
    unchanged: list[str]

    def as_dict(self) -> dict[str, list[str]]:
        return {
            "added": self.added,
            "changed": self.changed,
            "deleted": self.deleted,
            "unchanged": self.unchanged,
        }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_manifest(root: Path) -> dict[str, str]:
    if not root.exists():
        return {}

    manifest: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.name != INTERNAL_MANIFEST:
            manifest[str(path.relative_to(root)).replace("\\", "/")] = sha256_file(path)
    return manifest


def resolve_workspace(root: Path, workspace_ref: str) -> Path:
    if not WORKSPACE_REF_PATTERN.fullmatch(workspace_ref):
        raise ValueError("invalid_workspace_ref")

    resolved_root = root.resolve()
    resolved_workspace = (root / workspace_ref).resolve()
    if (
        resolved_workspace != resolved_root
        and resolved_root not in resolved_workspace.parents
    ):
        raise ValueError("workspace_ref_escapes_storage_root")
    return resolved_workspace


def hydrate_delta(
    object_store_root: Path, workspace_root: Path, workspace_ref: str
) -> DeltaResult:
    source_root = resolve_workspace(object_store_root, workspace_ref)
    target_root = resolve_workspace(workspace_root, workspace_ref)
    source_manifest = build_manifest(source_root)
    target_manifest = build_manifest(target_root)

    added: list[str] = []
    changed: list[str] = []
    unchanged: list[str] = []

    target_root.mkdir(parents=True, exist_ok=True)

    for relative_path, source_hash in source_manifest.items():
        source_file = source_root / relative_path
        target_file = target_root / relative_path
        target_file.parent.mkdir(parents=True, exist_ok=True)

        if relative_path not in target_manifest:
            added.append(relative_path)
            shutil.copy2(source_file, target_file)
        elif target_manifest[relative_path] != source_hash:
            changed.append(relative_path)
            shutil.copy2(source_file, target_file)
        else:
            unchanged.append(relative_path)

    deleted = sorted(set(target_manifest) - set(source_manifest))
    for relative_path in deleted:
        candidate = target_root / relative_path
        if candidate.exists() and candidate.is_file():
            candidate.unlink()

    result = DeltaResult(sorted(added), sorted(changed), deleted, sorted(unchanged))
    (target_root / INTERNAL_MANIFEST).write_text(
        json.dumps(result.as_dict(), indent=2), encoding="utf-8"
    )
    return result
