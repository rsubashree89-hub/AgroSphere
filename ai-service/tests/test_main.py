import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import app


class MockPlantIdClient:
    def __init__(self, response):
        self.response = response
        self.request_headers = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, _exc_type, _exc, _traceback):
        return None

    async def post(self, _url, *, headers, json):
        self.request_headers = headers
        self.payload = json
        return self.response


class CropHealthServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        transport = httpx.ASGITransport(app=app)
        self.client = httpx.AsyncClient(transport=transport, base_url="http://test")
        self.jpeg = b"\xff\xd8\xff" + b"test-image"

    async def asyncTearDown(self):
        await self.client.aclose()

    async def test_readiness_does_not_expose_provider_secret(self):
        with patch.dict(os.environ, {"PLANT_ID_API_KEY": "private-key-for-test"}):
            response = await self.client.get("/health/ready")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["plant_id_configured"])
        self.assertNotIn("private-key-for-test", response.text)

    async def test_missing_provider_key_returns_explicitly_unavailable(self):
        with patch.dict(os.environ, {}, clear=True):
            response = await self.client.post(
                "/api/v1/health-assessment",
                files={"image": ("crop.jpg", self.jpeg, "image/jpeg")},
            )
        self.assertEqual(response.status_code, 503)
        self.assertIn("PLANT_ID_API_KEY", response.json()["detail"])

    async def test_rejects_non_image_payload_without_calling_provider(self):
        with patch.dict(os.environ, {"PLANT_ID_API_KEY": "private-key-for-test"}):
            response = await self.client.post(
                "/api/v1/health-assessment",
                files={"image": ("crop.jpg", b"not-an-image", "image/jpeg")},
            )
        self.assertEqual(response.status_code, 415)

    async def test_preserves_provider_confidence_and_marks_low_confidence_uncertain(self):
        provider_response = SimpleNamespace(
            status_code=200,
            json=lambda: {
                "result": {
                    "is_healthy": {"binary": False},
                    "disease": {
                        "suggestions": [
                            {
                                "name": "Example leaf condition",
                                "probability": 0.42,
                                "details": {
                                    "description": "Provider description.",
                                    "treatment": "Provider treatment.",
                                },
                            }
                        ]
                    },
                }
            },
        )
        mock_provider = MockPlantIdClient(provider_response)
        with (
            patch.dict(os.environ, {"PLANT_ID_API_KEY": "private-key-for-test"}),
            patch("app.main.httpx.AsyncClient", return_value=mock_provider),
        ):
            response = await self.client.post(
                "/api/v1/health-assessment",
                files={"image": ("crop.jpg", self.jpeg, "image/jpeg")},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "uncertain")
        self.assertEqual(response.json()["confidence"], 0.42)
        self.assertEqual(response.json()["disease_name"], "Example leaf condition")
        self.assertEqual(mock_provider.request_headers["Api-Key"], "private-key-for-test")
        self.assertIn("images", mock_provider.payload)


if __name__ == "__main__":
    unittest.main()
