"""Optional Supabase persistence for Simi Studio.

The app remains runnable without credentials. Once SUPABASE_URL and
SUPABASE_SECRET_KEY are present, authenticated requests are required and all
job/video state is mirrored into Postgres. Failures are logged and never leak
the server secret into responses.
"""

from __future__ import annotations

import logging
import os
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx

try:
    from supabase import Client, create_client
except ImportError:  # Allows the existing local-only app to start before install.
    Client = Any  # type: ignore[misc,assignment]
    create_client = None

LOGGER = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class SupabaseStore:
    def __init__(self) -> None:
        self.url = os.environ.get("SUPABASE_URL", "").strip()
        self.secret_key = os.environ.get("SUPABASE_SECRET_KEY", "").strip()
        self.enabled = bool(self.url and self.secret_key and create_client)
        self._thread_clients = threading.local()

    @property
    def client(self) -> Optional[Client]:
        """Return one Supabase connection pool per Flask worker thread."""
        client = getattr(self._thread_clients, "client", None)
        if client is None and self.enabled and create_client:
            client = create_client(self.url, self.secret_key)
            self._thread_clients.client = client
        return client

    @client.setter
    def client(self, value: Optional[Client]) -> None:
        # Kept as a setter for focused tests and explicit dependency injection.
        self._thread_clients.client = value

    def _safe(self, operation: str, callback, default=None):
        if not self.client:
            return default
        try:
            return callback()
        except Exception as exc:  # Persistence must not terminate a render worker.
            LOGGER.error("Supabase %s failed: %s", operation, exc)
            return default

    def _upload_file(self, bucket: str, remote_path: str, local_path: Path, mime_type: str) -> Optional[str]:
        if not self.client or not local_path.is_file():
            return None
        try:
            with local_path.open("rb") as source:
                self.client.storage.from_(bucket).upload(
                    path=remote_path,
                    file=source,
                    file_options={"content-type": mime_type, "upsert": "true"},
                )
            return remote_path
        except Exception as exc:
            LOGGER.error("Supabase upload %s failed: %s", remote_path, exc)
            return None

    def authenticate(self, authorization: str) -> Tuple[Optional[str], Optional[str]]:
        if not self.enabled:
            return None, None
        if not authorization.startswith("Bearer "):
            return None, "Authentication required"
        token = authorization[7:].strip()
        if not token:
            return None, "Authentication required"
        try:
            # Do not reuse supabase-py's stateful Auth client across Flask
            # worker threads. A fresh request is deterministic and validates
            # the JWT against the project's Auth server on every request.
            response = httpx.get(
                f"{self.url}/auth/v1/user",
                headers={
                    "apikey": self.secret_key,
                    "Authorization": f"Bearer {token}",
                },
                timeout=10.0,
            )
            if response.status_code in {401, 403}:
                return None, "Invalid or expired session"
            response.raise_for_status()
            user_id = str(response.json().get("id") or "")
            return (user_id, None) if user_id else (None, "Invalid or expired session")
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout) as exc:
            LOGGER.error("Supabase Auth is unreachable: %s", type(exc).__name__)
            return None, "Authentication service temporarily unavailable"
        except Exception as exc:
            LOGGER.warning("Supabase rejected the presented session: %s", type(exc).__name__)
            return None, "Invalid or expired session"

    def create_job(self, user_id: Optional[str], job_id: str, payload: Dict[str, Any]) -> None:
        if not user_id:
            return
        row = {
            "id": job_id,
            "user_id": user_id,
            "prompt": str(payload.get("prompt", "")),
            "audience": str(payload.get("audience", "beginner")),
            "style": str(payload.get("style", "default")),
            "requested_duration_seconds": round(float(payload.get("duration_seconds", 0))),
            "mode": str(payload.get("mode", "batch")),
            "quality_mode": str(payload.get("quality_mode", "balanced")),
            "status": "queued",
            "stage": "queued",
            "progress": 0,
            "detail": "Queued",
            "request_payload": {key: value for key, value in payload.items() if key not in {"source_text", "full_source_text"}},
            "source_document_id": payload.get("source_document_id"),
        }
        self._safe("create job", lambda: self.client.table("video_jobs").insert(row).execute())  # type: ignore[union-attr]
        self._safe("record usage start", lambda: self.client.table("usage_events").insert({  # type: ignore[union-attr]
            "user_id": user_id, "job_id": job_id, "event_type": "video_started", "period_start": _now()
        }).execute())

    def create_source_document(self, user_id: Optional[str], filename: str, path: str, mime_type: Optional[str], size_bytes: int, text_length: int) -> Optional[str]:
        if not user_id:
            return None
        document_id = str(uuid.uuid4())
        local_path = Path(path)
        remote_path = f"{user_id}/sources/{document_id}/{filename}"
        stored_path = self._upload_file("source-documents", remote_path, local_path, mime_type or "application/octet-stream")
        row = {
            "id": document_id, "user_id": user_id, "original_filename": filename,
            "storage_path": stored_path or path, "mime_type": mime_type, "size_bytes": size_bytes,
            "extracted_text_length": text_length, "metadata": {"storage": "supabase" if stored_path else "local_pending_upload"},
        }
        response = self._safe("create source document", lambda: self.client.table("source_documents").insert(row).execute())  # type: ignore[union-attr]
        return document_id if response else None

    def update_job(self, job_id: str, changes: Dict[str, Any]) -> None:
        if not self.enabled:
            return
        allowed = {"status", "stage", "progress", "detail", "runtime_config", "llm_usage"}
        row = {key: value for key, value in changes.items() if key in allowed and value is not None}
        if "error" in changes:
            row["error_message"] = str(changes["error"])[:4000]
        if "llm_cost_usd" in changes:
            row["estimated_cost_usd"] = changes["llm_cost_usd"]
        if row.get("status") == "running":
            row["started_at"] = _now()
        if row.get("status") in {"completed", "failed", "canceled"}:
            row["completed_at"] = _now()
        if row:
            self._safe("update job", lambda: self.client.table("video_jobs").update(row).eq("id", job_id).execute())  # type: ignore[union-attr]

    def replace_scenes(self, user_id: Optional[str], job_id: str, scenes: List[Dict[str, Any]]) -> None:
        if not user_id or not scenes:
            return
        rows = [{
            "job_id": job_id,
            "user_id": user_id,
            "scene_index": int(scene.get("index", index)),
            "title": str(scene.get("title", f"Scene {index + 1}")),
            "narration": str(scene.get("narration", "")),
            "status": str(scene.get("status", "pending")),
            "image_url": scene.get("image_url"),
        } for index, scene in enumerate(scenes)]
        self._safe("upsert scenes", lambda: self.client.table("video_scenes").upsert(rows, on_conflict="job_id,scene_index").execute())  # type: ignore[union-attr]

    def update_scene(self, job_id: str, scene_index: int, changes: Dict[str, Any]) -> None:
        row = {key: value for key, value in changes.items() if key in {"title", "narration", "status", "image_url"}}
        if row:
            self._safe("update scene", lambda: self.client.table("video_scenes").update(row).eq("job_id", job_id).eq("scene_index", scene_index).execute())  # type: ignore[union-attr]

    def complete_video(self, user_id: Optional[str], job_id: str, manifest: Dict[str, Any]) -> None:
        if not user_id:
            return
        plan = manifest.get("plan") if isinstance(manifest.get("plan"), dict) else {}
        request_data = manifest.get("request") if isinstance(manifest.get("request"), dict) else {}
        scenes = plan.get("scenes") if isinstance(plan.get("scenes"), list) else manifest.get("segments", [])
        output_dir = Path(os.environ.get("OUTPUT_DIR", Path(__file__).resolve().parent / "outputs")) / job_id
        video_path = self._upload_file("video-assets", f"{user_id}/videos/{job_id}/final.mp4", output_dir / "final.mp4", "video/mp4")
        manifest_path = self._upload_file("video-assets", f"{user_id}/videos/{job_id}/manifest.json", output_dir / "manifest.json", "application/json")
        evaluation_path = self._upload_file("video-assets", f"{user_id}/videos/{job_id}/evaluation.json", output_dir / "evaluation.json", "application/json")
        row = {
            "id": job_id,
            "user_id": user_id,
            "title": str(plan.get("title") or request_data.get("prompt") or "Untitled explanation"),
            "description": str(plan.get("scope_summary") or plan.get("learning_goal") or ""),
            "audience": str(request_data.get("audience", "beginner")),
            "style": str(request_data.get("style") or "default"),
            "duration_seconds": float(manifest.get("final_duration_seconds") or request_data.get("target_duration_seconds") or 0),
            "scene_count": len(scenes),
            "video_url": f"/outputs/{job_id}/final.mp4",
            "video_storage_path": video_path,
            "manifest_storage_path": manifest_path,
            "evaluation_storage_path": evaluation_path,
            "manifest": manifest,
            "coverage": plan.get("must_cover", []),
        }
        self._safe("complete video", lambda: self.client.table("videos").upsert(row).execute())  # type: ignore[union-attr]
        assets = [
            {"user_id": user_id, "job_id": job_id, "video_id": job_id, "asset_type": "video", "storage_bucket": "video-assets" if video_path else "local", "storage_path": video_path or f"outputs/{job_id}/final.mp4", "mime_type": "video/mp4"},
            {"user_id": user_id, "job_id": job_id, "video_id": job_id, "asset_type": "manifest", "storage_bucket": "video-assets" if manifest_path else "local", "storage_path": manifest_path or f"outputs/{job_id}/manifest.json", "mime_type": "application/json"},
            {"user_id": user_id, "job_id": job_id, "video_id": job_id, "asset_type": "evaluation", "storage_bucket": "video-assets" if evaluation_path else "local", "storage_path": evaluation_path or f"outputs/{job_id}/evaluation.json", "mime_type": "application/json"},
        ]
        self._safe("record video assets", lambda: self.client.table("video_assets").upsert(assets, on_conflict="storage_bucket,storage_path").execute())  # type: ignore[union-attr]
        self._safe("link scenes", lambda: self.client.table("video_scenes").update({"video_id": job_id}).eq("job_id", job_id).execute())  # type: ignore[union-attr]

    def upload_scene_images(self, user_id: Optional[str], job_id: str, scenes: List[Dict[str, Any]]) -> None:
        if not user_id:
            return
        work_dir = Path(os.environ.get("WORK_DIR", Path(__file__).resolve().parent / "work")) / job_id
        for index, scene in enumerate(scenes):
            scene_index = int(scene.get("index", index))
            scene_number = scene_index + 1
            candidates = (
                work_dir / "segments" / f"scene_{scene_number:03d}" / "scene.png",
                work_dir / "scenes" / f"scene_{scene_number:03d}.png",
            )
            local_path = next((candidate for candidate in candidates if candidate.is_file()), None)
            if not local_path:
                continue
            remote_path = self._upload_file("video-assets", f"{user_id}/videos/{job_id}/scenes/{scene_number:03d}.png", local_path, "image/png")
            if remote_path:
                self._safe("store scene image", lambda: self.client.table("video_scenes").update({"image_storage_path": remote_path}).eq("job_id", job_id).eq("scene_index", scene_index).execute())  # type: ignore[union-attr]

    def quota_status(self, user_id: Optional[str]) -> Optional[Dict[str, Any]]:
        if not self.enabled or not user_id:
            return None
        try:
            profile = self.client.table("profiles").select("current_plan_id,videos_used,plan_reset_at").eq("id", user_id).single().execute().data  # type: ignore[union-attr]
            plan = self.client.table("plan_catalog").select("video_limit").eq("id", profile["current_plan_id"]).single().execute().data  # type: ignore[union-attr]
            reset_at = datetime.fromisoformat(str(profile["plan_reset_at"]).replace("Z", "+00:00"))
            used = int(profile.get("videos_used", 0))
            if reset_at <= datetime.now(timezone.utc):
                used = 0
                reset_at = datetime.now(timezone.utc) + timedelta(days=30)
                self.client.table("profiles").update({"videos_used": 0, "plan_period_start": _now(), "plan_reset_at": reset_at.isoformat()}).eq("id", user_id).execute()  # type: ignore[union-attr]
            limit = int(plan["video_limit"])
            return {"allowed": used < limit, "used": used, "limit": limit, "reset_at": reset_at.isoformat()}
        except Exception as exc:
            LOGGER.error("Supabase quota check failed: %s", exc)
            return {"allowed": False, "error": "Plan quota is temporarily unavailable"}

    def owns_job(self, user_id: Optional[str], job_id: str) -> bool:
        if not self.enabled:
            return True
        if not user_id:
            return False
        response = self._safe("check job owner", lambda: self.client.table("video_jobs").select("id").eq("id", job_id).eq("user_id", user_id).maybe_single().execute())  # type: ignore[union-attr]
        return bool(response and response.data)


supabase_store = SupabaseStore()
