"""
Firebase Authentication Middleware for FastAPI
Verifies Firebase ID tokens and manages user authentication
"""

import os
import logging
from typing import Optional
from fastapi import HTTPException, Security, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import firebase_admin
from firebase_admin import credentials, auth

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
        if os.getenv("ENVIRONMENT", "production").lower() in ("development", "dev", "local"):
            logging.warning("Firebase not initialized - bypassing token verification (dev mode only)")
            return {
                "uid": "local_dev_user",
                "email": "dev@suraksha.local",
                "name": "Development User"
            }
        raise HTTPException(
            status_code=503,
            detail="Authentication service unavailable. Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_PROJECT_ID."
        )
    
    token = credentials.credentials
    
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

def create_custom_token(uid: str, additional_claims: dict = None) -> str:
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
