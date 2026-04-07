"""
Firebase Authentication Middleware for FastAPI
Verifies Firebase ID tokens and manages user authentication
"""

import os
import logging
import base64
import json
from typing import Optional
from fastapi import HTTPException, Security, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import firebase_admin
from firebase_admin import credentials, auth
from dotenv import load_dotenv

load_dotenv()

# Initialize Firebase Admin SDK
firebase_initialized = False

def initialize_firebase():
    """Initialize Firebase Admin SDK with service account credentials"""
    global firebase_initialized
    
    if firebase_initialized:
        return
    
    try:
        # Option 1: Use service account JSON file
        service_account_path = os.getenv('FIREBASE_SERVICE_ACCOUNT_PATH')
        
        if service_account_path and os.path.exists(service_account_path):
            cred = credentials.Certificate(service_account_path)
            firebase_admin.initialize_app(cred)
            logging.info("Firebase Admin SDK initialized with service account file")
        else:
            # Option 2: Use default credentials (for Cloud Run, App Engine, etc.)
            # Or manually configure with environment variables
            project_id = os.getenv('FIREBASE_PROJECT_ID')
            
            if project_id:
                firebase_admin.initialize_app(options={
                    'projectId': project_id
                })
                logging.info(f"Firebase Admin SDK initialized for project: {project_id}")
            else:
                logging.warning("Firebase Admin SDK not initialized. Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_PROJECT_ID")
                return
        
        firebase_initialized = True
        
    except Exception as e:
        logging.error(f"Failed to initialize Firebase Admin SDK: {e}")

# Initialize on module load
initialize_firebase()

# Security scheme
security = HTTPBearer()
security_optional = HTTPBearer(auto_error=False)

DEFAULT_ADMIN_EMAILS = {"s.sam.11221177@gmail.com"}
DEFAULT_DEVELOPER_EMAILS = {"lightrex06@gmail.com"}


def _parse_email_set(env_name: str, default_values: set[str]) -> set[str]:
    raw = os.getenv(env_name, "").strip()
    if not raw:
        return {e.lower() for e in default_values}
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


ADMIN_EMAILS = _parse_email_set("ADMIN_EMAILS", DEFAULT_ADMIN_EMAILS)
DEVELOPER_EMAILS = _parse_email_set("DEVELOPER_EMAILS", DEFAULT_DEVELOPER_EMAILS)


def _is_dev_mode() -> bool:
    env = os.getenv("ENVIRONMENT", "production").strip().lower()
    if env in ("development", "dev", "local"):
        return True
    bypass = os.getenv("ALLOW_DEV_AUTH_BYPASS", "").strip().lower()
    return bypass in ("1", "true", "yes", "on")


def _role_from_email(email: Optional[str]) -> Optional[str]:
    mail = (email or "").strip().lower()
    if not mail:
        return None
    if mail in DEVELOPER_EMAILS:
        return "developer"
    if mail in ADMIN_EMAILS:
        return "admin"
    return None


def _decode_unverified_token(token: str) -> Optional[dict]:
    """Best-effort JWT payload decode for local development fallback."""
    try:
        parts = token.split(".")
        if len(parts) < 2:
            return None
        payload = parts[1]
        padded = payload + "=" * (-len(payload) % 4)
        decoded = base64.urlsafe_b64decode(padded.encode("utf-8"))
        claims = json.loads(decoded.decode("utf-8"))
    except Exception:
        return None

    uid = claims.get("uid") or claims.get("user_id") or claims.get("sub")
    email = claims.get("email")
    if not uid:
        return None

    fallback_role = os.getenv("DEV_FALLBACK_ROLE", "citizen").strip().lower() or "citizen"
    role = claims.get("role") or claims.get("user_type") or _role_from_email(email) or fallback_role
    return {
        "uid": uid,
        "email": email,
        "email_verified": bool(claims.get("email_verified", False)),
        "name": claims.get("name") or claims.get("display_name"),
        "picture": claims.get("picture"),
        "role": role,
        "firebase_claims": claims,
        "dev_unverified": True,
    }

async def verify_firebase_token(
    credentials: HTTPAuthorizationCredentials = Security(security)
) -> dict:
    """
    Verify Firebase ID token from Authorization header
    
    Args:
        credentials: Bearer token from Authorization header
    
    Returns:
        dict: Decoded token with user information
    
    Raises:
        HTTPException: If token is invalid or expired
    """
    if not firebase_initialized:
        # Only allow bypass in explicit development mode
        if _is_dev_mode():
            parsed = _decode_unverified_token(credentials.credentials)
            if parsed:
                logging.warning("Firebase not initialized - using unverified token claims (dev mode only)")
                return parsed

            fallback_role = os.getenv("DEV_FALLBACK_ROLE", "citizen").strip().lower() or "citizen"
            logging.warning("Firebase not initialized - bypassing token verification with fallback user (dev mode only)")
            return {
                "uid": "local_dev_user",
                "email": "dev@suraksha.local",
                "name": "Development User",
                "role": fallback_role,
                "firebase_claims": {},
                "dev_unverified": True,
            }
        raise HTTPException(
            status_code=503,
            detail="Authentication service unavailable. Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_PROJECT_ID."
        )
    
    token = credentials.credentials

    # In explicit local development mode, prefer fast unverified JWT decode
    # to avoid blocking on Firebase/ADC network verification.
    if _is_dev_mode():
        parsed = _decode_unverified_token(token)
        if parsed:
            logging.warning("Using unverified token claims (dev mode)")
            return parsed
    
    try:
        # Verify the ID token
        decoded_token = auth.verify_id_token(token)
        
        # Extract user information
        user_info = {
            "uid": decoded_token.get('uid'),
            "email": decoded_token.get('email'),
            "email_verified": decoded_token.get('email_verified', False),
            "name": decoded_token.get('name'),
            "picture": decoded_token.get('picture'),
            "role": decoded_token.get('role') or decoded_token.get('user_type') or _role_from_email(decoded_token.get('email')),
            "firebase_claims": decoded_token
        }
        
        return user_info
        
    except auth.ExpiredIdTokenError:
        raise HTTPException(
            status_code=401,
            detail="Token has expired. Please sign in again."
        )
    except auth.RevokedIdTokenError:
        raise HTTPException(
            status_code=401,
            detail="Token has been revoked. Please sign in again."
        )
    except auth.InvalidIdTokenError:
        raise HTTPException(
            status_code=401,
            detail="Invalid authentication token."
        )
    except Exception as e:
        logging.error(f"Token verification error: {e}")

        if _is_dev_mode():
            parsed = _decode_unverified_token(token)
            if parsed:
                logging.warning("Using unverified token claims because Firebase verification failed (dev mode only)")
                return parsed

        raise HTTPException(
            status_code=401,
            detail="Authentication failed."
        )

async def get_current_user(
    user_info: dict = Depends(verify_firebase_token)
) -> dict:
    """
    Get current authenticated user from Firebase token
    
    Args:
        user_info: Verified token information
    
    Returns:
        dict: Current user information
    """
    return user_info

async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security_optional)
) -> Optional[dict]:
    """
    Get current user if authenticated, None otherwise
    Useful for endpoints that work both authenticated and unauthenticated
    
    Args:
        credentials: Optional bearer token
    
    Returns:
        dict or None: User information if authenticated, None otherwise
    """
    if not credentials:
        return None
    
    try:
        return await verify_firebase_token(credentials)
    except HTTPException:
        return None

def create_custom_token(uid: str, additional_claims: Optional[dict] = None) -> str:
    """
    Create a custom Firebase token for a user
    Useful for server-side authentication
    
    Args:
        uid: User ID
        additional_claims: Optional custom claims to add to the token
    
    Returns:
        str: Custom token
    """
    if not firebase_initialized:
        raise Exception("Firebase not initialized")
    
    try:
        custom_token = auth.create_custom_token(uid, additional_claims)
        return custom_token.decode('utf-8')
    except Exception as e:
        logging.error(f"Failed to create custom token: {e}")
        raise

async def set_custom_user_claims(uid: str, claims: dict):
    """
    Set custom claims for a user (e.g., role, permissions)
    
    Args:
        uid: User ID
        claims: Custom claims dict (e.g., {"role": "admin", "verified": True})
    """
    if not firebase_initialized:
        raise Exception("Firebase not initialized")
    
    try:
        auth.set_custom_user_claims(uid, claims)
        logging.info(f"Set custom claims for user {uid}: {claims}")
    except Exception as e:
        logging.error(f"Failed to set custom claims: {e}")
        raise

async def get_user_by_email(email: str):
    """
    Get Firebase user by email
    
    Args:
        email: User email address
    
    Returns:
        UserRecord: Firebase user record
    """
    if not firebase_initialized:
        raise Exception("Firebase not initialized")
    
    try:
        user = auth.get_user_by_email(email)
        return user
    except auth.UserNotFoundError:
        return None
    except Exception as e:
        logging.error(f"Failed to get user by email: {e}")
        raise
