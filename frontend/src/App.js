import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { LocationProvider } from "@/contexts/LocationContext";
import { ErrorBoundary } from "@/components/errors/ErrorBoundary";
import ProtectedRoute from "@/components/ProtectedRoute";
import MainLayout from "@/components/layout/MainLayout";
import PWAInstallPrompt from "@/components/pwa/PWAInstallPrompt";
import OfflineIndicator from "@/components/pwa/OfflineIndicator";
import TelegramMiniApp from "@/components/TelegramMiniApp";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import ForgotPassword from "@/pages/ForgotPassword";
import Dashboard from "@/pages/Dashboard";
import MapView from "@/pages/MapView";
import Alerts from "@/pages/Alerts";
import Weather from "@/pages/Weather";
import Disasters from "@/pages/Disasters";
import Community from "@/pages/Community";
import Analytics from "@/pages/Analytics";
import StudentPortal from "@/pages/StudentPortal";
import ScientistPortal from "@/pages/ScientistPortal";
import AdminDashboard from "@/pages/AdminDashboard";
import CriticalContacts from "@/pages/CriticalContacts";
import Profile from "@/pages/Profile";

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <LocationProvider>
          <OfflineIndicator />
          <PWAInstallPrompt />
          <BrowserRouter>
          <Routes>
            {/* Public Routes */}
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            
            {/* Telegram Mini App Route - No Auth Required */}
            <Route path="/telegram-app" element={<TelegramMiniApp />} />
            
            {/* Protected Routes - Require Authentication */}
            <Route path="/app" element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }>
              <Route index element={<Navigate to="/app/dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="map" element={<MapView />} />
              <Route path="alerts" element={<Alerts />} />
              <Route path="weather" element={<Weather />} />
              <Route path="disasters" element={<Disasters />} />
              <Route path="community" element={<Community />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="critical-contacts" element={<CriticalContacts />} />
              <Route path="student" element={<StudentPortal />} />
              <Route path="scientist" element={<ScientistPortal />} />
              <Route path="admin" element={<AdminDashboard />} />
              <Route path="profile" element={<Profile />} />
            </Route>

            {/* Legacy routes - redirect to new structure */}
            <Route path="/dashboard" element={<Navigate to="/app/dashboard" replace />} />
            <Route path="/student" element={<Navigate to="/app/student" replace />} />
            <Route path="/scientist" element={<Navigate to="/app/scientist" replace />} />
            <Route path="/admin" element={<Navigate to="/app/admin" replace />} />
            
            {/* Catch all - redirect to landing */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </LocationProvider>
    </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
