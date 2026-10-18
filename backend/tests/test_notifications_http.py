from clientbridge.integrations.http import close_http_client, http_session, start_http_client


async def test_sender_pool_reuses_connections_until_application_shutdown() -> None:
    start_http_client()
    try:
        async with http_session() as first:
            assert not first.is_closed
        async with http_session() as second:
            assert second is first and not second.is_closed
    finally:
        await close_http_client()
    assert first.is_closed
    async with http_session() as temporary:
        assert temporary is not first
    assert temporary.is_closed
