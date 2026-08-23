# S3 Image Storage — Competitor Post Media

Competitor post images scraped from Instagram, Facebook, and TikTok are stored
in S3 so they survive CDN expiry (IG/FB URLs expire after ~24-48h; TikTok even faster).

Without S3 configured the scraper falls back to storing the raw CDN URL, which
will break after expiry. The frontend proxy (`/api/competitors/proxy-image`) also
only bypasses CORS — it cannot resurrect an expired URL.

---

## 1. Create the S3 bucket

```bash
aws s3api create-bucket \
  --bucket YOUR_BUCKET_NAME \
  --region us-east-1
```

For regions other than `us-east-1` add `--create-bucket-configuration LocationConstraint=REGION`.

**Block public access** — images are served via the bucket URL directly, so you need
to allow public reads. Either:

- Disable "Block all public access" in the console, OR
- Attach a bucket policy (recommended):

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicRead",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/*"
  }]
}
```

---

## 2. Create an IAM user / role

Create an IAM policy with minimal permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:PutObject", "s3:PutObjectAcl"],
    "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/competitor-posts/*"
  }]
}
```

Attach it to a dedicated IAM user, generate Access Key + Secret, and keep them safe.

---

## 3. Set environment variables on the server

Add these to your Render (or Railway) environment config:

| Variable | Example | Required |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | `AKIA...` | Yes |
| `AWS_SECRET_ACCESS_KEY` | `abc123...` | Yes |
| `AWS_S3_BUCKET` | `quiet-eyes-media` | Yes |
| `AWS_REGION` | `us-east-1` | No (defaults to `us-east-1`) |
| `AWS_CDN_URL` | `https://d1234.cloudfront.net` | No (defaults to S3 URL) |

`AWS_CDN_URL` is optional — set it if you put CloudFront in front of the bucket
for faster global delivery and lower egress cost.

---

## 4. How it works in the code

**`server/src/lib/s3.ts`** — the upload utility:
- `isS3Configured()` — returns true when all three required env vars are present
- `uploadImageFromUrl(url, folder?)` — downloads the image and uploads it to S3,
  returns the permanent URL or `null` on failure

**`collectCompetitorSocialPosts.ts`** — called at scrape time:
```
raw CDN URL  →  uploadImageFromUrl()  →  S3 URL stored in DB
```
Falls back to the raw CDN URL if S3 is not configured or the upload fails, so
the scraper never hard-fails because of missing S3 config.

**Frontend** — `SocialCompetition.jsx` still routes images through
`/api/competitors/proxy-image` for the CORS bypass. Once S3 URLs are stored,
the proxy is technically redundant for them (S3 public URLs work directly), but
it's harmless to keep it — it just proxies an already-accessible URL.

---

## 5. Optional: CloudFront CDN in front of S3

For production, add a CloudFront distribution pointed at the bucket:

1. Create a CloudFront distribution → origin: `YOUR_BUCKET_NAME.s3.amazonaws.com`
2. Set `AWS_CDN_URL=https://YOUR_CLOUDFRONT_DOMAIN` in env vars
3. All new uploads will use the CloudFront URL automatically

Benefits: global edge caching, lower S3 egress cost, HTTPS by default.

---

## 6. Backfilling existing posts

Existing posts in the DB still have expiring CDN URLs. To fix them, trigger a
forced re-scrape from the Social Competition page → "רענן פיד" button (with S3
configured). The scraper will re-fetch and upload images for any new or
updated posts. Old posts that have already expired cannot be recovered — their
images are gone from the source platform's CDN.
