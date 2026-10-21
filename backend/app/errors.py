class MediaError(Exception):
    """An actionable error safe to return to the frontend."""

    def __init__(self, message: str, status_code: int = 422):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


def friendly_error(output: str) -> str:
    text = output.lower()
    if any(word in text for word in ("sign in", "login", "log in", "cookies", "private")):
        return "This video requires sign-in or was blocked by the platform. Try a public video."
    if any(word in text for word in ("429", "403", "bot", "captcha", "po token")):
        return "The platform blocked this request. Try again later or try another video."
    if any(word in text for word in ("not available", "unavailable", "removed", "not found")):
        return "This video is unavailable, removed, or restricted in the server's region."
    if "format" in text and any(word in text for word in ("not available", "requested")):
        return "That format is no longer available. Fetch the video again to refresh its formats."
    if any(word in text for word in ("too large", "max-filesize", "larger than")):
        return "This file exceeds the download size limit. Choose a lower resolution."
    return "The platform could not provide this video. Try another public link."
