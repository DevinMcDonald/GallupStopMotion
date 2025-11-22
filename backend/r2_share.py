# r2_share.py
import os
import time
import uuid

import boto3
from botocore.client import Config
from dotenv import load_dotenv

load_dotenv()  # Load environment variables from .env file

R2_ACCOUNT_ID = os.environ["R2_ACCOUNT_ID"]
R2_ACCESS_KEY_ID = os.environ["R2_ACCESS_KEY_ID"]
R2_SECRET_ACCESS_KEY = os.environ["R2_SECRET_ACCESS_KEY"]
R2_BUCKET = os.environ["R2_BUCKET"]
R2_REGION = os.getenv("R2_REGION", "auto")
R2_ENDPOINT = f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

# S3 client pointed at R2 with s3v4 signing
s3 = boto3.client(
    "s3",
    region_name=R2_REGION,
    endpoint_url=R2_ENDPOINT,
    aws_access_key_id=R2_ACCESS_KEY_ID,
    aws_secret_access_key=R2_SECRET_ACCESS_KEY,
    config=Config(signature_version="s3v4"),
)


def create_share(video_bytes: bytes, content_type: str = "video/mp4"):
    key = f"exports/{uuid.uuid4()}.mp4"

    # Upload private by default
    s3.put_object(
        Bucket=R2_BUCKET,
        Key=key,
        Body=video_bytes,
        ContentType=content_type,
        # Optional: SSE
        # ServerSideEncryption="AES256",
    )

    # 24 hours for the presigned URL
    expires_seconds = 24 * 3600
    url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": R2_BUCKET, "Key": key},
        ExpiresIn=expires_seconds,
    )

    return {"url": url, "expiresAt": int(time.time()) + expires_seconds, "key": key}
