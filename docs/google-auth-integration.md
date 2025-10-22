// Frontend Integration Example for Google Authentication
// This shows how to integrate Google auth with your backend

// 1. Install Firebase SDK in your frontend
// npm install firebase

// 2. Initialize Firebase in your frontend
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "your-api-key",
  authDomain: "dailygist-d891d.firebaseapp.com",
  projectId: "dailygist-d891d",
  storageBucket: "dailygist-d891d.appspot.com",
  messagingSenderId: "your-sender-id",
  appId: "your-app-id"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// 3. Google Sign-In Function
export const signInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    
    // Get the ID token
    const idToken = await user.getIdToken();
    
    // Send to your backend
    const response = await fetch('http://localhost:50011/api/user/google-auth', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        idToken: idToken
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // Store the JWT token
      localStorage.setItem('token', data.data.token);
      
      // Redirect or update UI
      console.log('User authenticated:', data.data);
      return data.data;
    } else {
      throw new Error(data.message);
    }
  } catch (error) {
    console.error('Google sign-in error:', error);
    throw error;
  }
};

// 4. Usage in React Component
/*
import React from 'react';
import { signInWithGoogle } from './firebaseAuth';

const LoginComponent = () => {
  const handleGoogleSignIn = async () => {
    try {
      const userData = await signInWithGoogle();
      console.log('Logged in user:', userData);
      // Update your app state or redirect
    } catch (error) {
      console.error('Login failed:', error);
    }
  };

  return (
    <button onClick={handleGoogleSignIn}>
      Sign in with Google
    </button>
  );
};
*/

// 5. API Testing with cURL
/*
curl -X POST http://localhost:50011/api/user/google-auth \
  -H "Content-Type: application/json" \
  -d '{
    "idToken": "YOUR_FIREBASE_ID_TOKEN_HERE"
  }'
*/

// 6. Expected Response
/*
{
  "success": true,
  "message": "Google authentication successful",
  "data": {
    "_id": "64f8a1b2c3d4e5f6a7b8c9d0",
    "fullName": "John Doe",
    "email": "john.doe@gmail.com",
    "image": "https://lh3.googleusercontent.com/a/...",
    "role": ["buyer"],
    "activeRole": "buyer",
    "status": "active",
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "isGoogleAuth": true
  }
}
*/
