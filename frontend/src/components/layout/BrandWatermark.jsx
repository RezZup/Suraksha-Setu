import React from 'react';

/**
 * Brand Watermark - Fixed bottom-right logo overlay
 * Subtle branding element that appears on all app pages
 */
const BrandWatermark = () => {
  return (
    <div className="fixed bottom-4 right-4 z-40 pointer-events-none">
      <div className="bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm rounded-xl p-2 shadow-lg border border-gray-200/50 dark:border-gray-700/50">
        <img 
          src="/main_logo.png" 
          alt="DrishtiSetu"
          className="w-10 h-10 object-contain opacity-60 dark:opacity-50"
        />
      </div>
    </div>
  );
};

export default BrandWatermark;
