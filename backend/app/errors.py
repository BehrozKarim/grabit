class MediaError(Exception):
    """An actionable error safe to return to the frontend."""

    def __init__(self, message: str, status_code: int = 422):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


def friendly_error(output: str) -> str:
    text = output.lower()
    if "ip address is blocked" in text or "ip blocked" in text:
        return (
            "The platform blocked this backend's IP address. "
            "Try your own backend on another network."
        )
    # yt-dlp appends cookie instructions to bot/token errors too. Match the
    # actual restriction before treating those instructions as an account requirement.
    if "confirm" in text and ("not a bot" in text or "not a robot" in text):
        return (
            "The platform requires bot verification from this backend. "
            "A public video can still be blocked on a hosting network."
        )
    if any(word in text for word in ("po token", "po_token", "potoken")):
        return (
            "YouTube requires a verification token for this request. "
            "The backend needs a compatible PO-token provider."
        )
    if any(
        word in text
        for word in (
            "no supported javascript runtime",
            "javascript runtime is not available",
            "challenge solver script",
            "challenge solving failed",
        )
    ):
        return (
            "YouTube's JavaScript verification could not run. "
            "Check the backend's Node.js version and yt-dlp-ejs installation."
        )
    if "no suitable extractor" in text or "unsupported url" in text:
        return "This share URL is not recognized. Open the video and copy its original video link."
    if any(word in text for word in ("sign in", "login", "log in", "cookies", "private")):
        return "This video requires sign-in or was blocked by the platform. Try a public video."
    if any(word in text for word in ("429", "403", "bot", "captcha", "po token")):
        return "The platform blocked this request. Try again later or try another video."
    if "format" in text and any(word in text for word in ("not available", "requested")):
        return "That format is no longer available. Fetch the video again to refresh its formats."
    if any(word in text for word in ("not available", "unavailable", "removed", "not found")):
        return "This video is unavailable, removed, or restricted in the server's region."
    if any(word in text for word in ("too large", "max-filesize", "larger than")):
        return "This file exceeds the download size limit. Choose a lower resolution."
    return "The platform could not provide this video. Try another public link."
