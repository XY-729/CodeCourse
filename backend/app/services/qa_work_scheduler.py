"""Let new background model calls yield to interactive question answering."""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
import threading
from collections.abc import Iterator


_condition = threading.Condition()
_foreground_count = 0
_background_scope: ContextVar[bool] = ContextVar("qa_background_work", default=False)


@contextmanager
def foreground_work() -> Iterator[None]:
    """Track interactive work across threads without waiting for background calls."""
    global _foreground_count
    with _condition:
        _foreground_count += 1
    token = _background_scope.set(False)
    try:
        yield
    finally:
        try:
            _background_scope.reset(token)
        except ValueError:
            # Disconnected SSE generators can be finalized in another task's
            # context. Their foreground count must still be released.
            pass
        with _condition:
            _foreground_count -= 1
            if _foreground_count == 0:
                _condition.notify_all()


@contextmanager
def background_work() -> Iterator[None]:
    """Mark model requests from this task as deferrable; do not hold a DB lock."""
    token = _background_scope.set(True)
    try:
        yield
    finally:
        _background_scope.reset(token)


def wait_before_model_request() -> None:
    """Gate each new background attempt, leaving an already sent request alone.

    Ordinary synchronous model callers are unaffected. Call this immediately
    before sending a request, and always outside a database transaction.
    """
    if not _background_scope.get():
        return
    with _condition:
        _condition.wait_for(lambda: _foreground_count == 0)
