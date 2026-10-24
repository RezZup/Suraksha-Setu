import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ShieldAlert, Loader2, UserCircle, GraduationCap, FlaskConical, Phone } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const Register = () => {
  const navigate = useNavigate();
  const { register, signInWithGoogle, firebaseReady } = useAuth();
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    role: 'citizen'
  });

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (!formData.name || !formData.email || !formData.phone || !formData.password || !formData.confirmPassword) {
      setError('All fields are required');
      return;
    }

    // Validate Indian phone number
    const phoneClean = formData.phone.replace(/[\s\-]/g, '');
    const phoneRegex = /^(\+91)?[6-9]\d{9}$/;
    if (!phoneRegex.test(phoneClean)) {
      setError('Please enter a valid Indian mobile number (e.g., +91 9876543210)');
      return;
    }

    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters long');
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      await register(formData.email, formData.password, formData.name, formData.role, formData.phone);
      navigate('/dashboard');
    } catch (err) {
      console.error('Registration error:', err);
      let errorMessage = 'Registration failed. ';
      
      if (err.code === 'auth/email-already-in-use') {
        errorMessage += 'An account with this email already exists.';
      } else if (err.code === 'auth/invalid-email') {
        errorMessage += 'Invalid email address.';
      } else if (err.code === 'auth/weak-password') {
        errorMessage += 'Password is too weak. Use at least 6 characters.';
      } else {
        errorMessage += err.message || 'Please try again.';
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setGoogleLoading(true);

    try {
      await signInWithGoogle();
      navigate('/dashboard');
    } catch (err) {
      console.error('Google sign-in error:', err);
      let errorMessage = 'Google sign-in failed. ';
      
      if (err.code === 'auth/popup-closed-by-user') {
        errorMessage += 'Sign-in popup was closed.';
      } else if (err.code === 'auth/cancelled-popup-request') {
        errorMessage += 'Sign-in was cancelled.';
      } else {
        errorMessage += err.message || 'Please try again.';
      }
      
      setError(errorMessage);
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-primary/5 to-background p-4">
      <Card className="w-full max-w-md border-border/50 shadow-2xl bg-card/95 backdrop-blur">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-4">
            <div className="h-24 w-24 bg-gradient-to-br from-primary to-purple-500 rounded-full flex items-center justify-center shadow-lg p-4">
              <img src="/main_logo.png" alt="DrishtiSetu" className="h-full w-full object-contain" />
            </div>
          </div>
          <CardTitle className="text-3xl font-bold bg-gradient-to-r from-primary to-purple-500 bg-clip-text text-transparent">
            Create Account
          </CardTitle>
          <CardDescription className="text-base">Join DrishtiSetu for disaster safety</CardDescription>
        </CardHeader>
        <CardContent>
          {!firebaseReady && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>
                <div className="space-y-2">
                  <p className="font-semibold">⚠️ Firebase Configuration Error</p>
                  <p className="text-sm">Authentication is not configured. Please complete the Firebase setup:</p>
                  <ol className="text-xs list-decimal list-inside space-y-1 ml-2">
                    <li>Go to <a href="https://console.firebase.google.com" target="_blank" rel="noopener noreferrer" className="underline">Firebase Console</a></li>
                    <li>Open project: <strong>surakhsa-setu</strong></li>
                    <li>Navigate to: Authentication → Sign-in method</li>
                    <li>Enable: <strong>Email/Password</strong> provider</li>
                    <li>Enable: <strong>Google</strong> provider (optional)</li>
                    <li>Refresh this page after configuration</li>
                  </ol>
                </div>
              </AlertDescription>
            </Alert>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Full Name</Label>
              <Input 
                id="name"
                name="name"
                placeholder="Enter your full name" 
                type="text"
                value={formData.name}
                onChange={handleChange}
                disabled={loading || googleLoading || !firebaseReady}
                className="h-11"
                data-testid="register-name-input"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="role">I am a</Label>
              <Select 
                value={formData.role} 
                onValueChange={(value) => setFormData({...formData, role: value})}
                disabled={loading || googleLoading || !firebaseReady}
              >
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Select your role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="citizen">
                    <div className="flex items-center gap-2">
                      <UserCircle className="h-4 w-4" />
                      <span>Citizen</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="student">
                    <div className="flex items-center gap-2">
                      <GraduationCap className="h-4 w-4" />
                      <span>Student</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="scientist">
                    <div className="flex items-center gap-2">
                      <FlaskConical className="h-4 w-4" />
                      <span>Scientist/Researcher</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input 
                id="email"
                name="email"
                placeholder="your.email@example.com" 
                type="email"
                value={formData.email}
                onChange={handleChange}
                disabled={loading || googleLoading || !firebaseReady}
                className="h-11"
                data-testid="register-email-input"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Mobile Number</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                  id="phone"
                  name="phone"
                  placeholder="+91 9876543210" 
                  type="tel"
                  value={formData.phone}
                  onChange={handleChange}
                  disabled={loading || googleLoading || !firebaseReady}
                  className="h-11 pl-10"
                  data-testid="register-phone-input"
                />
              </div>
              <p className="text-xs text-muted-foreground">Used for emergency SMS alerts only</p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input 
                id="password"
                name="password"
                placeholder="At least 6 characters" 
                type="password"
                value={formData.password}
                onChange={handleChange}
                disabled={loading || googleLoading || !firebaseReady}
                className="h-11"
                data-testid="register-password-input"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input 
                id="confirmPassword"
                name="confirmPassword"
                placeholder="Re-enter your password" 
                type="password"
                value={formData.confirmPassword}
                onChange={handleChange}
                disabled={loading || googleLoading || !firebaseReady}
                className="h-11"
                data-testid="register-confirm-password-input"
              />
            </div>

            {error && (
              <Alert variant="destructive" data-testid="register-error-message">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            
            <Button 
              type="submit" 
              className="w-full h-11 bg-gradient-to-r from-primary to-purple-500 hover:from-primary/90 hover:to-purple-500/90" 
              disabled={loading || googleLoading || !firebaseReady}
              data-testid="register-submit-button"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating account...
                </>
              ) : (
                'Create Account'
              )}
            </Button>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
              </div>
            </div>

            <Button 
              type="button"
              variant="outline"
              className="w-full h-11 border-2"
              onClick={handleGoogleSignIn}
              disabled={loading || googleLoading || !firebaseReady}
            >
              {googleLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing up...
                </>
              ) : (
                <>
                  <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Sign up with Google
                </>
              )}
            </Button>
            
            <div className="text-center text-sm text-muted-foreground pt-4">
              Already have an account?{' '}
              <Link to="/login" className="text-primary hover:underline font-medium">
                Sign in
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default Register;
