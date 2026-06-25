"""Dump the FastAPI OpenAPI schema to stdout — feeds the TS api-client generator."""

import json

from clientbridge.main import app

if __name__ == "__main__":
    print(json.dumps(app.openapi(), indent=2))
