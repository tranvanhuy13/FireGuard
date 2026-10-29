"""Bot delivery shared by independent camera and uploaded-video events."""
import logging
import hashlib
import os
import re
import threading
import time
from urllib.parse import quote

import requests
from database import get_setting
import database

logger = logging.getLogger(__name__)
last_notification = {}
_delivery_lock = threading.Lock()
_in_flight = set()
NOTIFICATION_COOLDOWN = 60
ZALO_API_BASE = "https://bot-api.zaloplatforms.com"
CHANNELS = ("zalo", "telegram")


def setting(key):
    """Environment (including loaded dotenv) wins; otherwise use persisted settings."""
    value = os.getenv(key.upper())
    if value is not None and value.strip():
        return value.strip()
    return str(get_setting(key) or "").strip()


def channel_config(channel):
    token = setting(f"{channel}_bot_token")
    chat_id = setting(f"{channel}_chat_id")
    saved = []
    if getattr(database, "DB_NAME", None) is not None:
        from notification_targets import list_targets
        saved = list_targets(channel=channel)
    targets = [item for item in saved if item["active"]] if saved else (
        [{"id": "default", "chatId": chat_id}] if chat_id else [])
    flag = setting(f"{channel}_enabled").lower()
    # Explicit false is authoritative; otherwise credentials enable a new channel.
    enabled = flag in ("true", "1", "yes", "on") if flag else bool(token and targets)
    return {"token": token, "chat_id": targets[0]["chatId"] if targets else "", "enabled": enabled,
            "targets": targets, "saved_targets": bool(saved), "configured": bool(token and targets)}


def configuration_status():
    """Admin-only effective settings; never return raw tokens."""
    settings, status = {}, {}
    for channel in CHANNELS:
        config = channel_config(channel)
        settings.update({
            f"{channel}_bot_token": "********" if config["token"] else "",
            f"{channel}_chat_id": config["chat_id"],
            f"{channel}_enabled": str(config["enabled"]).lower(),
        })
        status[channel] = {
            "configured": config["configured"], "enabled": config["enabled"],
            "state": "unconfigured" if not config["configured"] else "disabled" if not config["enabled"] else "ready",
            "source": {suffix: "environment" if (os.getenv(f"{channel}_{suffix}".upper()) or "").strip()
                       else "database" for suffix in ("bot_token", "chat_id", "enabled")},
        }
        if config["saved_targets"]:
            status[channel]["source"]["chat_id"] = "recipients"
        status[channel]["target_count"] = len(config["targets"])
    return settings, status


def _safe_description(value):
    """Keep provider explanations useful without exposing credentials or URLs."""
    value = str(value or "")
    for channel in CHANNELS:
        for suffix in ("bot_token", "chat_id"):
            secret = setting(f"{channel}_{suffix}")
            if secret:
                value = value.replace(secret, "[redacted]").replace(quote(secret, safe=""), "[redacted]")
        for target in channel_config(channel)["targets"]:
            value = value.replace(target["chatId"], "[redacted]")
    value = re.sub(r"https?://\S+", "[redacted URL]", value)
    value = re.sub(r"\b\d{5,}:[A-Za-z0-9_-]+\b", "[redacted token]", value)
    return " ".join(value.split())[:300]


def _post(url, *, cancelled=None, details=None, request_attempts=3, **kwargs):
    """Bounded retries; never log token-bearing URLs or provider response bodies."""
    request_attempts = max(1, min(3, int(request_attempts)))
    for attempt in range(request_attempts):
        if details is not None:
            details.clear()
        if cancelled is not None and cancelled.is_set():
            if details is not None:
                details.update(reason="cancelled")
            return False, "cancelled"
        delay = 1 + attempt
        try:
            for stream in (kwargs.get("files") or {}).values():
                stream.seek(0)
            response = requests.post(url, timeout=(3, 10), **kwargs)
            try:
                body = response.json()
            except ValueError:
                body = {}
            if not isinstance(body, dict):
                body = {}
            if response.status_code == 200 and body.get("ok") is True:
                return True, ""
            code = body.get("error_code", response.status_code)
            if details is not None:
                details.update(http_status=response.status_code,
                               error_code=code if isinstance(code, int) else response.status_code,
                               description=_safe_description(body.get("description")) or "Bot API rejected the request")
            retry = response.status_code == 429 or code == 429 or response.status_code >= 500
            error = "rate_limited" if response.status_code == 429 or code == 429 else "provider_rejected"
            if details is not None:
                details["reason"] = error
            if error == "rate_limited":
                parameters = body.get("parameters") or {}
                retry_after = parameters.get("retry_after") if isinstance(parameters, dict) else None
                retry_after = retry_after or response.headers.get("Retry-After", delay)
                try:
                    delay = max(delay, float(retry_after))
                except (TypeError, ValueError):
                    pass
                if not 0 <= delay <= 10:
                    if details is not None:
                        details["retry_after"] = delay if delay >= 0 and delay < float("inf") else 30
                    return False, error
                if details is not None:
                    details["retry_after"] = delay
        except requests.RequestException as exc:
            retry, error = True, "network_error"
            if details is not None:
                details.update(reason="timeout" if isinstance(exc, requests.Timeout) else "network_error",
                               description="Bot API request timed out" if isinstance(exc, requests.Timeout)
                               else "Unable to connect to the bot API")
        if not retry or attempt == request_attempts - 1:
            return False, error
        if cancelled is not None:
            if cancelled.wait(delay):
                if details is not None:
                    details.update(reason="cancelled", description="Delivery cancelled")
                return False, "cancelled"
        else:
            time.sleep(delay)
    return False, "delivery_failed"


def _zalo_call(token, method, payload, cancelled=None, details=None, request_attempts=3):
    return _post(f"{ZALO_API_BASE}/bot{token}/{method}", json=payload, cancelled=cancelled,
                 details=details, request_attempts=request_attempts)


def send_zalo(message, snapshot_path=None, *, cancelled=None, details=None, request_attempts=3, chat_id=None):
    """Send warning text and an expiring direct S3 image link."""
    try:
        config = channel_config("zalo")
        destination = chat_id or config["chat_id"]
        if not config["token"] or not destination:
            if details is not None:
                details.update(reason="unconfigured", description="Missing Zalo token or destination")
            return False
        if snapshot_path:
            from storage import snapshot_public_url
            photo_url = snapshot_public_url(os.path.basename(snapshot_path))
            message += (f"\n\nẢnh sự kiện (liên kết có thời hạn):\n{photo_url}" if photo_url else
                        "\n\nẢnh S3 chưa khả dụng. Vui lòng kiểm tra ảnh trên dashboard.")
        ok, error = _zalo_call(config["token"], "sendMessage",
                               {"chat_id": destination, "text": message}, cancelled=cancelled,
                               details=details, request_attempts=request_attempts)
        if not ok:
            logger.warning("Zalo delivery failed: %s", error)
        return ok
    except Exception:
        logger.warning("Zalo delivery failed; check configuration and storage")
        return False


def send_telegram(message, snapshot_path=None, *, cancelled=None, details=None, request_attempts=3, chat_id=None):
    """Upload a local photo when available; otherwise deliver warning text."""
    details = {} if details is None else details
    try:
        config = channel_config("telegram")
        destination = chat_id or config["chat_id"]
        if not config["token"] or not destination:
            if details is not None:
                details.update(reason="unconfigured", description="Missing Telegram token or chat ID")
            return False
        base = f"https://api.telegram.org/bot{config['token']}"
        photo_error = {}
        if snapshot_path and os.path.exists(snapshot_path):
            try:
                # Telegram photo captions are limited to 1024 characters.
                # Long messages go directly as text to preserve the full warning.
                if len(message.encode("utf-16-le")) // 2 > 1024:
                    photo_error.update(reason="caption_too_long", description="Photo caption exceeds the limit")
                else:
                    with open(snapshot_path, "rb") as image:
                        ok, error = _post(base + "/sendPhoto", cancelled=cancelled, details=photo_error,
                                          request_attempts=request_attempts,
                                          files={"photo": image},
                                          data={"chat_id": destination, "caption": message})
                    if ok:
                        if details is not None:
                            details.update(mode="photo")
                        return True
                    # Do not duplicate an ambiguous delivery or retry bad credentials
                    # as text. Only known media/caption rejections are recoverable.
                    description = photo_error.get("description", "").lower()
                    media_error = photo_error.get("error_code") in (400, 413) and (
                        photo_error.get("error_code") == 413 or any(term in description for term in (
                            "photo", "image", "caption", "file", "dimension", "too large", "too big", "media")))
                    if not media_error:
                        if details is not None:
                            details.update(photo_error)
                        logger.warning("Telegram photo delivery failed: %s; HTTP=%s API=%s; %s",
                                       photo_error.get("reason", error), photo_error.get("http_status"),
                                       photo_error.get("error_code"), photo_error.get("description", ""))
                        return False
            except OSError:
                photo_error.update(reason="snapshot_unreadable", description="Unable to read the snapshot file")
            ok, error = _post(base + "/sendMessage", cancelled=cancelled, details=details,
                              request_attempts=request_attempts,
                              data={"chat_id": destination, "text": message})
            if details is not None:
                details.update(mode="text", fallback_reason=photo_error.get("reason", "media_rejected"),
                               photo_error=photo_error)
        else:
            ok, error = _post(base + "/sendMessage", cancelled=cancelled, details=details,
                              request_attempts=request_attempts,
                              data={"chat_id": destination, "text": message})
            if details is not None:
                details["mode"] = "text"
        if not ok:
            logger.warning("Telegram delivery failed: %s; HTTP=%s API=%s; %s", error,
                           details.get("http_status"), details.get("error_code"), details.get("description", ""))
        return ok
    except Exception:
        if details is not None:
            details.update(reason="delivery_error", description="Unable to prepare Telegram notification")
        logger.warning("Telegram delivery failed; check configuration and snapshot")
        return False


def trigger_notifications(event_type, confidence, snapshot_path=None, *, context=None,
                          cancelled=None, bypass_cooldown=False, camera_name=None,
                          channels=None, request_attempts=3, recipient_results=None):
    """Return per-channel outcomes; video deduplication is owned by its job queue."""
    body = (f"WARNING!\n\nThe system detected {event_type} with {confidence * 100:.1f}% confidence."
            f"\nTime: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    if camera_name is not None:
        name = " ".join(str(camera_name).split())[:160] or "Unnamed camera"
        body += f"\nSource: camera\nCamera: {name}"
    if context:
        body += (f"\nSource: uploaded video\nVideo: {context['filename'][:160]}"
                 f"\nJob: {context['job_id']}\nVideo time: {context['video_time']:.2f}s")
    body += "\n\nPlease check the dashboard immediately."
    results = {}
    for channel in CHANNELS:
        if channels is not None and channel not in channels:
            continue
        config = channel_config(channel)
        if not config["enabled"] or not config["configured"]:
            results[channel] = {"status": "unconfigured" if not config["configured"] else "disabled",
                                "description": "Channel is disabled; enable it in Settings or set " + channel.upper() + "_ENABLED=true"
                                if config["configured"] else "No active recipients in Notification Accounts/Groups"
                                if config["saved_targets"] and not config["targets"] else "Missing bot token or chat ID"}
            continue
        if cancelled is not None and cancelled.is_set():
            results[channel] = {"status": "cancelled"}
            continue
        key = f"camera:{channel}"
        use_cooldown = not context and not bypass_cooldown
        with _delivery_lock:
            if use_cooldown and (key in _in_flight or time.monotonic() - last_notification.get(key, -1e9) < NOTIFICATION_COOLDOWN):
                results[channel] = {"status": "cooldown"}
                continue
            if use_cooldown:
                _in_flight.add(key)
        try:
            sender = send_zalo if channel == "zalo" else send_telegram
            delivered = {}
            for target in config["targets"]:
                key_id = target["id"] + ":" + hashlib.sha256(target["chatId"].encode()).hexdigest()[:16]
                previous = (recipient_results or {}).get(key_id, {})
                transient = previous.get("reason") in ("timeout", "network_error", "rate_limited") or previous.get("http_status", 0) >= 500
                if previous.get("status") == "sent" or (previous.get("status") == "failed" and not transient):
                    delivered[key_id] = previous
                    continue
                details = {}
                ok = sender(body, snapshot_path, cancelled=cancelled, details=details,
                            request_attempts=request_attempts, chat_id=target["chatId"])
                delivered[key_id] = {"status": "sent" if ok else
                                     "cancelled" if cancelled is not None and cancelled.is_set() else "failed", **details}
            failures = [item for item in delivered.values() if item["status"] != "sent"]
            failures.sort(key=lambda item: not (item.get("reason") in ("timeout", "network_error", "rate_limited") or item.get("http_status", 0) >= 500))
            summary = dict(failures[0]) if failures else dict(next(iter(delivered.values())))
            summary.update(recipients=delivered, target_count=len(delivered),
                           sent_count=sum(item["status"] == "sent" for item in delivered.values()))
            results[channel] = summary
            if not failures and use_cooldown:
                with _delivery_lock:
                    last_notification[key] = time.monotonic()
        except Exception:
            logger.warning("%s delivery failed", channel)
            results[channel] = {"status": "failed"}
        finally:
            if use_cooldown:
                with _delivery_lock:
                    _in_flight.discard(key)
    return results
