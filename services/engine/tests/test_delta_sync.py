from pathlib import Path

import pytest

from sandbox_engine.delta_sync import build_manifest, hydrate_delta, resolve_workspace


def test_build_manifest_returns_empty_mapping_for_missing_root(tmp_path: Path) -> None:
    assert build_manifest(tmp_path / "missing") == {}


def test_hydrate_delta_copies_only_changed_files(tmp_path: Path) -> None:
    object_store = tmp_path / "object-store"
    workspaces = tmp_path / "workspaces"
    source = object_store / "demo"
    target = workspaces / "demo"
    source.mkdir(parents=True)
    target.mkdir(parents=True)

    (source / "a.txt").write_text("new", encoding="utf-8")
    (source / "b.txt").write_text("same", encoding="utf-8")
    (target / "b.txt").write_text("same", encoding="utf-8")
    (target / "c.txt").write_text("stale", encoding="utf-8")

    result = hydrate_delta(object_store, workspaces, "demo")

    assert result.added == ["a.txt"]
    assert result.changed == []
    assert result.deleted == ["c.txt"]
    assert result.unchanged == ["b.txt"]
    assert build_manifest(target)["a.txt"]
    assert not (target / "c.txt").exists()


def test_hydrate_delta_updates_changed_nested_files(tmp_path: Path) -> None:
    object_store = tmp_path / "object-store"
    workspaces = tmp_path / "workspaces"
    source = object_store / "demo" / "nested"
    target = workspaces / "demo" / "nested"
    source.mkdir(parents=True)
    target.mkdir(parents=True)

    (source / "task.py").write_text("print('new')", encoding="utf-8")
    (target / "task.py").write_text("print('old')", encoding="utf-8")

    result = hydrate_delta(object_store, workspaces, "demo")

    assert result.changed == ["nested/task.py"]
    assert (target / "task.py").read_text(encoding="utf-8") == "print('new')"


def test_hydrate_delta_is_warm_when_manifests_match(tmp_path: Path) -> None:
    object_store = tmp_path / "object-store"
    workspaces = tmp_path / "workspaces"
    source = object_store / "demo"
    source.mkdir(parents=True)
    (source / "task.py").write_text("print('same')", encoding="utf-8")

    first = hydrate_delta(object_store, workspaces, "demo")
    second = hydrate_delta(object_store, workspaces, "demo")

    assert first.added == ["task.py"]
    assert second.added == []
    assert second.changed == []
    assert second.deleted == []
    assert second.unchanged == ["task.py"]


def test_internal_delta_manifest_is_not_part_of_workspace_diff(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / ".delta-manifest.json").write_text("{}", encoding="utf-8")

    assert build_manifest(workspace) == {}


def test_resolve_workspace_rejects_path_traversal(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="invalid_workspace_ref"):
        resolve_workspace(tmp_path, "../outside")
