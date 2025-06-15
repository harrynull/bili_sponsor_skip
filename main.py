import os
from openai import OpenAI
from dotenv import load_dotenv
from pydantic import BaseModel
import json
import instructor
import dbm
import hashlib
from fastapi import Request, FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging

app = FastAPI()

load_dotenv()

client = instructor.from_openai(
    OpenAI(api_key=os.getenv("DEEPSEEK_API_KEY"), base_url="https://api.deepseek.com")
)

store = dbm.open("ads.db", "c")

LOG = logging.getLogger(__name__)
MODEL = "deepseek-chat"
PROMPT = """Please extract any advertisement and sponsored content from the following subtitle text.
                1. Combine ads into segments if they're part of the same ad, or close in timestamps.
                2. Return as few segments as possible.
                3. Make the topic as concise as possible.
                4. Identified segments should typically be longer than 10 seconds.
                4.1. For example, one sentence callout should be ignored.
                5. Identified segments should typically be more 10 seconds apart.
                6. Identified segments must be unrelated to the main content of the video.
                6.1. For example, asking to support the channel is not an ad."""


class Ad(BaseModel):
    start_time: float
    end_time: float
    topic: str


class AdList(BaseModel):
    segments: list[Ad]


def reformat(subtitle_json) -> str:
    body = subtitle_json["body"]
    return "\n".join(
        f"{item['from']}->{item['to']}: {item['content']}" for item in body
    )


def get_ads_no_cache(subtitle_text: str) -> AdList:
    subtitle_text = reformat(json.loads(subtitle_text))
    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {
                "role": "system",
                "content": PROMPT,
            },
            {
                "role": "user",
                "content": subtitle_text,
            },
        ],
        response_model=AdList,
        max_retries=0,
    )
    return response


@app.get("/")
def read_root():
    return {"system": "running"}


@app.post("/ads/text")
async def ads_by_subtitle(request: Request):
    """
    Extract ads from subtitle text.
    """
    text = await request.body()
    subtitle_sha256 = hashlib.sha256(text).hexdigest()

    # Check if ads are already cached
    ads = get_ads_from_db(subtitle_sha256)
    if ads is not None:
        return {"ads": ads, "sha256": subtitle_sha256}

    # If not cached, extract ads using the model
    LOG.info(f"Extracting ads for subtitle {subtitle_sha256}...")
    ads = get_ads_no_cache(text.decode()).segments

    # Save the extracted ads to the database
    save_ads_to_db(subtitle_sha256, ads)

    return {"ads": ads, "sha256": subtitle_sha256}


@app.get("/ads/sha256/{subtitle_sha256}")
def ads_by_subtitle_sha256(subtitle_sha256: str):
    """
    Extract ads from subtitle text by SHA256 hash.
    """
    ads = get_ads_from_db(subtitle_sha256)
    if ads is None:
        return {"error": "No ads found for the given subtitle SHA256 hash."}
    return {"ads": ads}


def get_ads_from_db(subtitle_sha256: str) -> list[Ad] | None:
    """
    Get ads from the database by subtitle SHA256 hash.
    """
    if subtitle_sha256 in store:
        ads_json = store[subtitle_sha256]
        return json.loads(ads_json, object_hook=lambda d: Ad(**d))
    return None


def save_ads_to_db(subtitle_sha256: str, ads: list[Ad]):
    """
    Save ads to the database by subtitle SHA256 hash.
    """
    store[subtitle_sha256] = json.dumps(ads)


app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)
