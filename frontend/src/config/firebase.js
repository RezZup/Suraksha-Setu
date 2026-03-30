import { initializeApp } from 'firebase/app';
import { getAnalytics } from 'firebase/analytics';
import { 
  getAuth, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  sendPasswordResetEmail,
  updateProfile
} from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBR0Kbv95na40v8WdznKLiyruGkY70keuc",
  authDomain: "surakhsa-setu.firebaseapp.com",
  projectId: "surakhsa-setu",
  storageBucket: "surakhsa-setu.firebasestorage.app",
  messagingSenderId: "791422434644",
  appId: "1:791422434644:web:f1207980bf4ce64b50dcc1",
  measurementId: "G-MFPZ90JFFH"
};

// Initialize Firebase
let app;
let analytics;
let initError = null;

try {
  app = initializeApp(firebaseConfig);
  analytics = getAnalytics(app);
  console.log('✅ Firebase initialized successfully');
} catch (error) {
  initError = error;
  console.error('❌ Firebase initialization failed:', error.message);
  console.error('Full error:', error);
}

if (!app) {
  throw new Error(
    'Firebase initialization failed. Please check your Firebase configuration. ' +
    'Ensure the project exists and credentials are correct in firebase.js'
  );
}

// Initialize Firebase Authentication and get a reference to the service
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
export { analytics };
export const isFirebaseConfigured = !!app && !initError;

// Firestore helper: save user profile with phone number
export const saveUserProfile = async (uid, profileData) => {
  try {
    await setDoc(doc(db, 'users', uid), profileData, { merge: true });
    console.log('User profile saved to Firestore');
  } catch (error) {
    console.error('Error saving user profile:', error);
    throw error;
  }
};

// Firestore helper: get user profile
export const getUserProfile = async (uid) => {
  try {
    const docSnap = await getDoc(doc(db, 'users', uid));
    return docSnap.exists() ? docSnap.data() : null;
  } catch (error) {
    console.error('Error getting user profile:', error);
    return null;
  }
};

// Authentication functions
export const registerWithEmail = async (email, password, displayName) => {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    
    // Update display name
    if (displayName && userCredential.user) {
      await updateProfile(userCredential.user, {
        displayName: displayName
      });
    }
    
    return userCredential.user;
  } catch (error) {
    console.error('Registration error:', error);
    throw error;
  }
};

export const loginWithEmail = async (email, password) => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return userCredential.user;
  } catch (error) {
    console.error('Login error:', error);
    throw error;
  }
};

export const loginWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.error('Google login error:', error);
    throw error;
  }
};

export const logout = async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error('Logout error:', error);
    throw error;
  }
};

export const resetPassword = async (email) => {
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (error) {
    console.error('Password reset error:', error);
    throw error;
  }
};

export default app;
