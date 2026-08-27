from pathlib import Path

import incremental_video_assembler as assembler_module
import segment_pipeline
from incremental_video_assembler import IncrementalVideoAssembler


def _segment(tmp_path: Path, scene_id: int) -> Path:
    path = tmp_path / "segments" / f"scene_{scene_id:03d}" / "segment.mp4"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"fake mp4")
    return path


def test_diagram_helper_is_not_shadowed_by_function_local_import():
    assert callable(segment_pipeline.has_diagram)
    assert "has_diagram" not in segment_pipeline._build_segment.__code__.co_varnames


def test_assembler_buffers_parallel_results_until_scene_order(monkeypatch, tmp_path):
    paths = {scene_id: _segment(tmp_path, scene_id) for scene_id in (1, 2, 3)}
    durations = {str(path): float(scene_id) for scene_id, path in paths.items()}
    monkeypatch.setattr(
        assembler_module,
        "audio_duration_seconds",
        lambda path: durations[str(path)],
    )

    assembler = IncrementalVideoAssembler(tmp_path)
    rebuilds = []
    monkeypatch.setattr(
        assembler,
        "_rebuild",
        lambda scenes: rebuilds.append([p.parent.name for p in scenes]),
    )

    assert assembler.add_scene(paths[3], scene_id=3) == 0
    assert rebuilds == []

    assert assembler.add_scene(paths[1], scene_id=1) == 1
    assert rebuilds[-1] == ["scene_001"]

    assert assembler.add_scene(paths[2], scene_id=2) == 6
    assert rebuilds[-1] == ["scene_001", "scene_002", "scene_003"]
    manifest = assembler.manifest()
    assert [scene["n"] for scene in manifest["scenes"]] == [1, 2, 3]
    assert [scene["start_seconds"] for scene in manifest["scenes"]] == [0, 1, 3]


def test_live_player_uses_complete_mp4_fallback():
    template = (Path(__file__).parents[1] / "templates" / "stream_player.html").read_text(
        encoding="utf-8"
    )
    assert "function canUseMSE()" in template
    assert "return false;" in template
    assert "handleJobCompleted" in template
    assert "video.src = `${final.href}?v=${Date.now()}`" in template


def test_visual_requests_have_a_startup_safe_timeout():
    source = (Path(__file__).parents[1] / "visual_engine.py").read_text(encoding="utf-8")
    assert "VISUAL_REQUEST_TIMEOUT_SECONDS" in source
    assert '"12"' in source
