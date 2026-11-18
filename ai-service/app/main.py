import base64
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

app = FastAPI(title="AgroSphere Crop Health Service", version="1.0.0")
MAX_IMAGE_BYTES = 5 * 1024 * 1024
PLANT_ID_URL = "https://api.plant.id/v3/health_assessment"


class HealthAssessment(BaseModel):
    status: str
    provider: str
    disease_name: str | None = None
    confidence: float | None = None
    is_healthy: bool | None = None
    description: str | None = None
    treatment: str | None = None
    message: str | None = None


def image_content_type(data: bytes) -> str | None:
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


@app.get("/health/live")
async def liveness():
    return {"status": "ok"}


@app.get("/health/ready")
async def readiness():
    configured = bool(os.environ.get("PLANT_ID_API_KEY", "").strip())
    return {
        "status": "ready" if configured else "degraded",
        "plant_id_configured": configured,
    }


@app.post("/api/v1/health-assessment", response_model=HealthAssessment)
async def health_assessment(image: UploadFile = File(...)):
    api_key = os.environ.get("PLANT_ID_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="Crop health analysis is unavailable: PLANT_ID_API_KEY is not configured.",
        )

    data = await image.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image must be no larger than 5 MB.")
    content_type = image_content_type(data)
    if not content_type:
        raise HTTPException(
            status_code=415,
            detail="Upload a valid JPEG, PNG, or WebP image.",
        )

    payload = {
        "images": [base64.b64encode(data).decode("ascii")],
        "health": {"details": ["local_name", "description", "treatment"]},
    }
    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(
                PLANT_ID_URL,
                headers={"Api-Key": api_key},
                json=payload,
            )
    except httpx.TimeoutException as error:
        raise HTTPException(status_code=504, detail="Plant.id analysis timed out.") from error
    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=502,
            detail="Unable to reach the Plant.id analysis provider.",
        ) from error

    if response.status_code in (401, 403):
        raise HTTPException(
            status_code=503,
            detail="Plant.id rejected the configured API key. Verify provider configuration.",
        )
    if response.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail="Plant.id could not analyze this image.",
        )

    try:
        body = response.json()
    except ValueError as error:
        raise HTTPException(
            status_code=502,
            detail="Plant.id returned an invalid response.",
        ) from error
    result = body.get("result") if isinstance(body, dict) else None
    if not isinstance(result, dict):
        raise HTTPException(
            status_code=502,
            detail="Plant.id returned an incomplete analysis.",
        )

    health = result.get("is_healthy")
    health = health if isinstance(health, dict) else {}
    disease = result.get("disease")
    disease = disease if isinstance(disease, dict) else {}
    suggestions = disease.get("suggestions")
    diseases = suggestions if isinstance(suggestions, list) else []
    top = diseases[0] if diseases and isinstance(diseases[0], dict) else {}
    probability = top.get("probability")
    confidence = (
        float(probability)
        if isinstance(probability, (int, float)) and 0 <= probability <= 1
        else None
    )
    healthy = health.get("binary")
    healthy = healthy if isinstance(healthy, bool) else None

    if healthy is True:
        return HealthAssessment(
            status="analyzed",
            provider="Plant.id",
            is_healthy=True,
            message="The provider did not identify a health issue in this image. This is not a substitute for expert diagnosis.",
        )
    if not top:
        return HealthAssessment(
            status="uncertain",
            provider="Plant.id",
            is_healthy=healthy if isinstance(healthy, bool) else None,
            message="The provider could not identify a specific condition. Consider consulting an agronomist.",
        )

    details = top.get("details")
    details = details if isinstance(details, dict) else {}
    disease_name = top.get("name")
    disease_name = disease_name if isinstance(disease_name, str) else None
    description = details.get("description")
    description = description if isinstance(description, str) else None
    treatment = details.get("treatment")
    treatment = treatment if isinstance(treatment, str) else None
    if confidence is None or confidence < 0.5:
        status = "uncertain"
        message = "The provider's result is uncertain. Consult a qualified agronomist before taking action."
    else:
        status = "analyzed"
        message = "AI-generated guidance; verify with a qualified agronomist before taking action."
    return HealthAssessment(
        status=status,
        provider="Plant.id",
        disease_name=disease_name,
        confidence=confidence,
        is_healthy=healthy,
        description=description,
        treatment=treatment,
        message=message,
    )
