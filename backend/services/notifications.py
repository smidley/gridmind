"""Notification service - email (SMTP) and webhooks (Slack, Discord, etc.).

Configuration is read from setup_store (web UI) first, falling back to
environment variables for backward compatibility.
"""

import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

import httpx
import aiosmtplib

from config import settings
from services import setup_store

logger = logging.getLogger(__name__)


def _get_smtp_config() -> dict:
    """Get SMTP config from setup_store, falling back to env vars."""
    return {
        "host": setup_store.get("notify_smtp_host", "") or settings.smtp_host,
        "port": int(setup_store.get("notify_smtp_port", 0) or settings.smtp_port or 587),
        "username": setup_store.get("notify_smtp_username", "") or settings.smtp_username,
        "password": setup_store.get_raw("notify_smtp_password", "") or settings.smtp_password,
        "from_email": setup_store.get("notify_smtp_from", "") or settings.smtp_from_email,
        "to_email": setup_store.get("notify_email", "") or settings.notification_email,
    }


def _get_webhook_url() -> str:
    """Get webhook URL from setup_store, falling back to env var."""
    return setup_store.get("notify_webhook_url", "") or settings.webhook_url


def is_configured() -> bool:
    """Check if any notification channel is configured."""
    smtp = _get_smtp_config()
    webhook = _get_webhook_url()
    return bool(smtp["host"] and smtp["to_email"]) or bool(webhook)


async def send_notification(title: str, message: str, level: str = "info"):
    """Send a notification via all configured channels.

    Args:
        title: Short notification title
        message: Notification body
        level: "info", "warning", or "critical"
    """
    results = []

    # Email
    smtp = _get_smtp_config()
    if smtp["host"] and smtp["to_email"]:
        try:
            await send_email(title, message, smtp)
            results.append(("email", True))
        except Exception as e:
            logger.error("Email notification failed: %s", e)
            results.append(("email", False))

    # Webhook
    webhook_url = _get_webhook_url()
    if webhook_url:
        try:
            await send_webhook(title, message, level, webhook_url)
            results.append(("webhook", True))
        except Exception as e:
            logger.error("Webhook notification failed: %s", e)
            results.append(("webhook", False))

    if not results:
        logger.debug("No notification channels configured, skipping: %s", title)

    return results


async def send_email(subject: str, body: str, smtp: dict | None = None):
    """Send an email notification via SMTP."""
    if smtp is None:
        smtp = _get_smtp_config()

    msg = MIMEMultipart()
    msg["From"] = smtp["from_email"] or smtp["username"]
    msg["To"] = smtp["to_email"]
    msg["Subject"] = f"[GridMind] {subject}"

    html_body = f"""
    <html>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px;">
        <div style="max-width: 500px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px;">
            <h2 style="color: #1a1a1a; margin-top: 0;">&#9889; {subject}</h2>
            <p style="color: #444; line-height: 1.6;">{body}</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
            <p style="color: #888; font-size: 12px;">Sent by GridMind - Tesla Powerwall Automation</p>
        </div>
    </body>
    </html>
    """
    msg.attach(MIMEText(html_body, "html"))

    await aiosmtplib.send(
        msg,
        hostname=smtp["host"],
        port=smtp["port"],
        username=smtp["username"],
        password=smtp["password"],
        use_tls=True,
    )
    logger.info("Sent email notification: %s", subject)


async def send_webhook(title: str, message: str, level: str = "info", url: str | None = None):
    """Send a webhook notification (supports Slack, Discord, and generic JSON)."""
    if url is None:
        url = _get_webhook_url()
    if not url:
        return

    if "discord" in url.lower():
        payload = _format_discord(title, message, level)
    elif "slack" in url.lower() or "hooks.slack.com" in url.lower():
        payload = _format_slack(title, message, level)
    else:
        payload = {
            "title": title,
            "message": message,
            "level": level,
            "source": "GridMind",
        }

    async with httpx.AsyncClient() as client:
        response = await client.post(url, json=payload, timeout=10.0)
        response.raise_for_status()

    logger.info("Sent webhook notification: %s", title)


def _format_slack(title: str, message: str, level: str) -> dict:
    """Format payload for Slack incoming webhooks."""
    color_map = {"info": "#36a64f", "warning": "#ff9900", "critical": "#ff0000"}
    return {
        "attachments": [
            {
                "color": color_map.get(level, "#36a64f"),
                "title": f"⚡ {title}",
                "text": message,
                "footer": "GridMind",
            }
        ]
    }


def _format_discord(title: str, message: str, level: str) -> dict:
    """Format payload for Discord webhooks."""
    color_map = {"info": 0x36A64F, "warning": 0xFF9900, "critical": 0xFF0000}
    return {
        "embeds": [
            {
                "title": f"⚡ {title}",
                "description": message,
                "color": color_map.get(level, 0x36A64F),
                "footer": {"text": "GridMind"},
            }
        ]
    }
