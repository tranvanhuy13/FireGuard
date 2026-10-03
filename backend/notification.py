import requests
import os
import time
from urllib.parse import quote
from database import get_setting

# Store last notification time to prevent spamming
# Format: {channel: timestamp}
last_notification = {}
NOTIFICATION_COOLDOWN = 60 # seconds

# Zalo Bot Platform (create a bot at https://bot.zapps.me)
ZALO_API_BASE = "https://bot-api.zaloplatforms.com"

def _zalo_call(token, method, payload):
    """Call a Zalo Bot API method. Returns (ok, error_text)."""
    url = f"{ZALO_API_BASE}/bot{token}/{method}"
    response = requests.post(url, json=payload, timeout=15)
    try:
        data = response.json()
    except ValueError:
        data = {}
    if response.status_code == 200 and data.get("ok", False):
        return True, ""
    return False, data.get("description") or response.text

def send_zalo(message, snapshot_path=None):
    """
    Send a Zalo message using Bot API settings from database.

    Zalo's sendPhoto only accepts a public image URL (no file upload), so the
    snapshot is sent only when "public_base_url" is set to an address that
    reaches this backend from the internet (domain / tunnel). Otherwise a
    text-only message is sent.
    """
    try:
        bot_token = get_setting("zalo_bot_token")
        chat_id = get_setting("zalo_chat_id")
        public_base_url = (get_setting("public_base_url") or "").strip()

        if not all([bot_token, chat_id]):
            print("Zalo notification skipped: Missing Bot settings.")
            return False

        if snapshot_path and public_base_url and os.path.exists(snapshot_path):
            photo_url = f"{public_base_url.rstrip('/')}/snapshots/{quote(os.path.basename(snapshot_path))}"
            ok, error = _zalo_call(bot_token, "sendPhoto",
                                   {"chat_id": chat_id, "photo": photo_url, "caption": message})
            if ok:
                print(f"Zalo photo sent to {chat_id}")
                return True
            print(f"Zalo sendPhoto failed ({error}), falling back to text only.")

        ok, error = _zalo_call(bot_token, "sendMessage", {"chat_id": chat_id, "text": message})
        if ok:
            print(f"Zalo message sent to {chat_id}")
            return True
        print(f"Zalo failed: {error}")
        return False

    except Exception as e:
        print(f"Failed to send zalo: {e}")
        return False

def send_telegram(message, snapshot_path=None):
    """Send a Telegram message using Bot API settings from database."""
    try:
        bot_token = get_setting("telegram_bot_token")
        chat_id = get_setting("telegram_chat_id")
        
        if not all([bot_token, chat_id]):
            print("Telegram notification skipped: Missing Bot settings.")
            return False

        # Send Photo if available
        if snapshot_path and os.path.exists(snapshot_path):
            url = f"https://api.telegram.org/bot{bot_token}/sendPhoto"
            with open(snapshot_path, "rb") as f:
                files = {"photo": f}
                data = {"chat_id": chat_id, "caption": message}
                response = requests.post(url, data=data, files=files)
        else:
            # Send Text only
            url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
            data = {"chat_id": chat_id, "text": message}
            response = requests.post(url, data=data)
            
        if response.status_code == 200:
            print(f"Telegram message sent to {chat_id}")
            return True
        else:
            print(f"Telegram failed: {response.text}")
            return False

    except Exception as e:
        print(f"Failed to send telegram: {e}")
        return False

def trigger_notifications(event_type, confidence, snapshot_path=None):
    """Trigger all enabled notifications with cooldown check."""
    global last_notification
    current_time = time.time()
    
    # Global cooldown to avoid spamming for same event burst
    if current_time - last_notification.get("global", 0) < NOTIFICATION_COOLDOWN:
        print("Notification skipped due to cooldown.")
        return

    confidence_percent = f"{confidence * 100:.1f}%"
    body = f"WARNING!\n\nThe system detected {event_type} with {confidence_percent} confidence.\nTime: {time.strftime('%Y-%m-%d %H:%M:%S')}\n\nPlease check the dashboard immediately."
    
    # Threading could be added here to not block the main loop, 
    # but for now synchronous call is safer to ensure delivery log visibility.
    
    zalo_enabled = get_setting("zalo_enabled") == "true"
    telegram_enabled = get_setting("telegram_enabled") == "true"
    
    if zalo_enabled:
        send_zalo(body, snapshot_path)
        
    if telegram_enabled:
        send_telegram(body, snapshot_path)
        
    last_notification["global"] = current_time