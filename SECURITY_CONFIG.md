# Security Configuration Guide

This document describes the security improvements and configuration options for GridMind.

## Environment Variables for Secrets

Instead of hardcoding sensitive values, use environment variables:

### Required Secrets

```bash
# Tesla Fleet API credentials
GRIDMIND_TESLA_CLIENT_ID=your_client_id
GRIDMIND_TESLA_CLIENT_SECRET=your_client_secret

# JWT secret for session tokens (auto-generated if not provided)
GRIDMIND_JWT_SECRET_KEY=your_secret_key_here
```

### Optional Secrets

```bash
# SMTP for email notifications
GRIDMIND_SMTP_PASSWORD=your_smtp_password

# OpenAI API key for AI insights
GRIDMIND_OPENAI_API_KEY=your_openai_key

# Webhook URLs (if using webhooks)
GRIDMIND_WEBHOOK_URL=https://your-webhook-url
```

## Secure Cookie Configuration

Session cookies should always use the `secure` flag in production to ensure they're only sent over HTTPS.

### Current Implementation

```python
# In main.py, line 227
secure=not settings.debug  # Secure in production (HTTPS via reverse proxy)
```

### Recommended Change

```python
# Use the security_config helper
from security_config import should_use_secure_cookies

response.set_cookie(
    key="gridmind_session",
    value=token,
    httponly=True,
    samesite="lax",
    max_age=60 * 60 * 24 * 30,
    secure=should_use_secure_cookies(),  # Always True unless debug=True
)
```

### Environment Variable Override

```bash
# Force secure cookies even in debug mode
GRIDMIND_SESSION_COOKIE_SECURE=true

# Disable secure cookies (NOT recommended for production)
GRIDMIND_SESSION_COOKIE_SECURE=false
```

## JWT Secret Key Management

The `security_config.py` module provides automatic JWT secret management:

1. **Environment Variable** (highest priority): `GRIDMIND_JWT_SECRET_KEY`
2. **Persisted File**: `data/.jwt_secret` (auto-generated and saved)
3. **Auto-Generation**: Creates new secret if neither exists

### Manual Secret Generation

```bash
# Generate a secure random secret
python3 -c "import secrets; print(secrets.token_urlsafe(32))"

# Set as environment variable
export GRIDMIND_JWT_SECRET_KEY="your_generated_secret"
```

## HTTPS Requirement

GridMind **requires HTTPS in production** when `secure=True` cookies are enabled.

### Deployment Options

1. **Reverse Proxy** (recommended):
   - Use Nginx Proxy Manager, Traefik, or Caddy
   - Terminate SSL at the proxy
   - Forward to GridMind on HTTP internally

2. **Direct HTTPS**:
   - Configure FastAPI with SSL certificates
   - Not recommended for Docker deployments

### Example Nginx Configuration

```nginx
server {
    listen 443 ssl http2;
    server_name gridmind.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Security Validation

Use the `validate_secrets()` function to check configuration:

```python
from security_config import validate_secrets, log_security_status

# Check which secrets are configured
secrets_status = validate_secrets()
print(secrets_status)
# {'jwt_secret': True, 'tesla_client_id': True, ...}

# Log security status at startup
log_security_status()
```

## Docker Compose Example

```yaml
version: '3.8'
services:
  gridmind:
    image: ghcr.io/smidley/gridmind:latest
    environment:
      - GRIDMIND_TESLA_CLIENT_ID=${TESLA_CLIENT_ID}
      - GRIDMIND_TESLA_CLIENT_SECRET=${TESLA_CLIENT_SECRET}
      - GRIDMIND_JWT_SECRET_KEY=${JWT_SECRET_KEY}
      - GRIDMIND_SMTP_PASSWORD=${SMTP_PASSWORD}
      - GRIDMIND_OPENAI_API_KEY=${OPENAI_API_KEY}
      - GRIDMIND_SESSION_COOKIE_SECURE=true
    volumes:
      - ./data:/app/data
    ports:
      - "8080:8000"
```

## Best Practices

1. **Never commit secrets** to version control
2. **Use environment variables** for all sensitive data
3. **Enable HTTPS** in production (required for secure cookies)
4. **Rotate secrets** periodically
5. **Use strong passwords** (12+ characters with complexity)
6. **Monitor failed login attempts** (rate limiting is enabled)
7. **Keep dependencies updated** for security patches

## Security Checklist

- [ ] HTTPS enabled via reverse proxy
- [ ] `GRIDMIND_JWT_SECRET_KEY` set in environment
- [ ] Tesla API credentials in environment variables
- [ ] SMTP password in environment (if using email)
- [ ] Session cookies have `secure=True` in production
- [ ] Strong app password configured (12+ chars)
- [ ] Rate limiting enabled on control endpoints
- [ ] CSRF protection enabled (see CSRF_PROTECTION.md)

