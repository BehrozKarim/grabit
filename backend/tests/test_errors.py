import pytest

from app.errors import friendly_error


@pytest.mark.parametrize(
    ("output", "expected"),
    [
        ("Sign in to confirm you're not a bot. Use --cookies", "bot verification"),
        ("Sign in to confirm you are not a robot. Use --cookies", "bot verification"),
        ("Missing PO Token. Supply --cookies", "verification token"),
        ("youtube:po_token is required", "verification token"),
        ("No supported JavaScript runtime could be found", "JavaScript verification"),
        ("challenge solver scripts are missing", "JavaScript verification"),
        ("Requested format is not available", "format is no longer available"),
        ("This video is private. Sign in", "requires sign-in"),
        ("Your IP address is blocked", "IP address"),
    ],
)
def test_specific_restriction_takes_priority_over_generic_hints(output, expected):
    message = friendly_error(output + " https://source.example/?token=secret")
    assert expected in message
    assert "secret" not in message
    assert "source.example" not in message
