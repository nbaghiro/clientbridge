"""Values a deployed environment derives from its base domain; stdlib only, so Pulumi imports it."""

# __Host- makes the cookie host-only, Secure and path /, so no other host of the domain can set it
SESSION_COOKIE = "__Host-cb_session"
NATIVE_RETURN_URL = "clientbridge://auth/callback"
AUTH_COMMAND = ("serve", "-c", "/etc/config/auth/kratos.yml", "--watch-courier")
# set from secrets next to auth_env(): never in the yml or in this module
AUTH_SECRETS = (
    "DSN",
    "SECRETS_COOKIE",
    "SECRETS_CIPHER",
    "COURIER_HTTP_REQUEST_CONFIG_AUTH_CONFIG_VALUE",
    "SELFSERVICE_METHODS_OIDC_CONFIG_PROVIDERS_0_CLIENT_ID",
    "SELFSERVICE_METHODS_OIDC_CONFIG_PROVIDERS_0_CLIENT_SECRET",
)
POWERSYNC_SECRETS = ("PS_SOURCE_URI", "PS_STORAGE_URI")


def public_urls(base_domain: str) -> dict[str, str]:
    """Every public URL of one environment, keyed by the API setting it fills."""
    # Connect's hosts call the public routes; the marketing site never calls the API
    origins = (f"book.{base_domain}", f"pay.{base_domain}", f"shop.{base_domain}")
    return {
        "api_base_url": f"https://api.{base_domain}",
        "auth_public_url": f"https://api.{base_domain}/auth",
        "web_base_url": f"https://app.{base_domain}",
        "admin_base_url": f"https://admin.{base_domain}",
        "business_page_url": f"https://{{slug}}.{base_domain}",
        "book_base_url": f"https://book.{base_domain}",
        "shop_base_url": f"https://shop.{base_domain}",
        "pay_base_url": f"https://pay.{base_domain}",
        # the marketing site, which also serves the images every email shows
        "cors_allow_origins": ",".join(f"https://{host}" for host in origins),
    }


def payment_domains(base_domain: str) -> tuple[str, ...]:
    """The hosts that show Stripe Elements; each connected account registers them for wallets."""
    return tuple(f"{host}.{base_domain}" for host in ("app", "book", "pay", "shop"))


def auth_env(base_domain: str, *, api_url: str, admin_url: str) -> dict[str, str]:
    """The auth service's environment over infra/auth/kratos.yml; the URLs are in-cluster."""
    app = f"https://app.{base_domain}"
    return {
        "SERVE_PUBLIC_BASE_URL": f"https://api.{base_domain}/auth/",
        "SERVE_PUBLIC_CORS_ALLOWED_ORIGINS": app,
        "SERVE_ADMIN_BASE_URL": f"{admin_url.rstrip('/')}/",
        "SESSION_COOKIE_NAME": SESSION_COOKIE,
        "SESSION_COOKIE_PATH": "/",
        "SESSION_COOKIE_SAME_SITE": "Lax",
        "COOKIES_PATH": "/",
        "COOKIES_SAME_SITE": "Lax",
        "SELFSERVICE_DEFAULT_BROWSER_RETURN_URL": f"{app}/",
        "SELFSERVICE_ALLOWED_RETURN_URLS": f"{app},{NATIVE_RETURN_URL}",
        "SELFSERVICE_METHODS_WEBAUTHN_CONFIG_RP_ID": f"app.{base_domain}",
        "SELFSERVICE_METHODS_WEBAUTHN_CONFIG_RP_ORIGINS": app,
        "SELFSERVICE_FLOWS_ERROR_UI_URL": f"{app}/auth-error",
        "SELFSERVICE_FLOWS_LOGIN_UI_URL": f"{app}/login",
        "SELFSERVICE_FLOWS_REGISTRATION_UI_URL": f"{app}/signup",
        "SELFSERVICE_FLOWS_VERIFICATION_UI_URL": f"{app}/verify",
        "SELFSERVICE_FLOWS_VERIFICATION_AFTER_DEFAULT_BROWSER_RETURN_URL": f"{app}/",
        "SELFSERVICE_FLOWS_RECOVERY_UI_URL": f"{app}/recover",
        "SELFSERVICE_FLOWS_SETTINGS_UI_URL": f"{app}/setup/security",
        "SELFSERVICE_FLOWS_LOGOUT_AFTER_DEFAULT_BROWSER_RETURN_URL": f"{app}/login",
        "COURIER_HTTP_REQUEST_CONFIG_URL": f"{api_url.rstrip('/')}/webhooks/auth-email",
        "LOG_FORMAT": "json",
    }


def powersync_env(*, api_url: str) -> dict[str, str]:
    """PowerSync's environment for infra/powersync/powersync.deployed.yaml, mounted at /config."""
    return {
        "POWERSYNC_CONFIG_PATH": "/config/powersync.deployed.yaml",
        "PS_JWKS_URI": f"{api_url.rstrip('/')}/sync/keys",
    }
