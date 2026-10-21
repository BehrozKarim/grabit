import math


def positive_number(value: object) -> float | None:
    if isinstance(value, (int, float)) and math.isfinite(value) and value > 0:
        return float(value)
    return None
