import React from 'react';
import { LanguageCode } from '../types/dictionary';

interface ArtworkBannerProps {
  language?: LanguageCode;
  variant?: 'hero' | 'compact' | 'onboarding';
  className?: string;
}

export const ArtworkBanner: React.FC<ArtworkBannerProps> = ({
  language,
  variant = 'hero',
  className = '',
}) => {
  const heightClass =
    variant === 'onboarding'
      ? 'h-64 sm:h-72 md:h-80'
      : variant === 'compact'
      ? 'h-36 sm:h-44'
      : 'h-48 sm:h-56';

  // Specific color accents per language motif, rooted in deep forest green and warm earth
  const colorThemes: Record<
    string,
    { primary: string; secondary: string; sphere1: string; sphere2: string; arch: string }
  > = {
    general: {
      primary: '#142E23', // Deep forest green
      secondary: '#204334',
      sphere1: '#E08B74', // Dusty coral
      sphere2: '#8E82A8', // Muted mauve
      arch: '#5A826B',
    },
    en: {
      primary: '#142E23',
      secondary: '#204033',
      sphere1: '#7E9E88',
      sphere2: '#D4A373',
      arch: '#466D57',
    },
    ha: {
      primary: '#1D2A20',
      secondary: '#283C2F',
      sphere1: '#D97753', // Terracotta indigo contrast
      sphere2: '#E4A853', // Amber ochre
      arch: '#486854',
    },
    yo: {
      primary: '#182C22',
      secondary: '#264235',
      sphere1: '#C98246', // Bronze/brass of Ife
      sphere2: '#7E9E88',
      arch: '#608670',
    },
    ff: {
      primary: '#11291E',
      secondary: '#1D3F30',
      sphere1: '#6FA48C', // Sahel pasture sage
      sphere2: '#D89E68', // Calabash amber
      arch: '#3E6A53',
    },
    ar: {
      primary: '#132820',
      secondary: '#1F3C30',
      sphere1: '#548C74', // Islamic emerald
      sphere2: '#C99E5C', // Gold leaf
      arch: '#365D4B',
    },
    fr: {
      primary: '#162721',
      secondary: '#233C33',
      sphere1: '#748DA6', // Slate blue
      sphere2: '#DFA386', // Rose stone
      arch: '#4A685D',
    },
    zh: {
      primary: '#1E2420',
      secondary: '#2E3831',
      sphere1: '#C05C4A', // Cinnabar seal red
      sphere2: '#748C7C', // Celadon jade
      arch: '#43564A',
    },
  };

  const theme = colorThemes[language || 'general'] || colorThemes.general;

  return (
    <div
      className={`relative w-full overflow-hidden ${heightClass} select-none ${className}`}
      style={{
        backgroundColor: theme.primary,
        backgroundImage: `radial-gradient(ellipse at 80% 20%, ${theme.secondary} 0%, ${theme.primary} 100%)`,
      }}
    >
      {/* Abstract organic spheres and architectural arcs inspired by the design reference */}
      <svg
        className="absolute inset-0 w-full h-full object-cover"
        viewBox="0 0 600 360"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Subtle noise grain filter */}
          <filter id="subtleGrain" x="0%" y="0%" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" result="noise" />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0   0 0 0 0 0   0 0 0 0 0  0 0 0 0.07 0"
            />
            <feBlend mode="multiply" in="SourceGraphic" result="blend" />
          </filter>

          {/* Spherical directional gradients */}
          <radialGradient id="sphereGrad1" cx="35%" cy="35%" r="65%">
            <stop offset="0%" stopColor="#FFF2ED" stopOpacity="0.9" />
            <stop offset="45%" stopColor={theme.sphere1} stopOpacity="0.95" />
            <stop offset="100%" stopColor="#1B221E" stopOpacity="0.9" />
          </radialGradient>

          <radialGradient id="sphereGrad2" cx="30%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#F5EDF8" stopOpacity="0.9" />
            <stop offset="50%" stopColor={theme.sphere2} stopOpacity="0.9" />
            <stop offset="100%" stopColor="#121C17" stopOpacity="0.9" />
          </radialGradient>

          <radialGradient id="sphereGradSmall" cx="35%" cy="35%" r="65%">
            <stop offset="0%" stopColor="#FFFDF7" stopOpacity="0.95" />
            <stop offset="60%" stopColor={theme.sphere1} stopOpacity="0.85" />
            <stop offset="100%" stopColor="#162E23" stopOpacity="0.9" />
          </radialGradient>

          <linearGradient id="archGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={theme.arch} stopOpacity="0.5" />
            <stop offset="100%" stopColor={theme.primary} stopOpacity="0.2" />
          </linearGradient>
        </defs>

        {/* Backing geometric arc contours */}
        <g opacity="0.35">
          <circle cx="300" cy="240" r="190" fill="none" stroke="#FFFFFF" strokeWidth="1.2" strokeDasharray="3 4" />
          <path d="M 120 360 C 120 180, 480 180, 480 360" fill="none" stroke="#FFFFFF" strokeWidth="1" />
          <path d="M 210 360 C 210 240, 390 240, 390 360" fill="none" stroke={theme.arch} strokeWidth="1.5" />
        </g>

        {/* Deep organic dark shape */}
        <path
          d="M 600,0 L 380,0 C 350,110 420,220 540,250 C 600,265 600,360 600,360 Z"
          fill={theme.secondary}
          opacity="0.8"
        />

        {/* Large Focal Central Sphere */}
        <circle cx="370" cy="170" r="95" fill="url(#sphereGrad2)" />

        {/* Secondary overlapping sphere */}
        <circle cx="270" cy="225" r="72" fill="url(#sphereGrad1)" />

        {/* Small floating celestial sphere */}
        <circle cx="480" cy="110" r="42" fill="url(#sphereGradSmall)" />

        {/* Muted background sphere */}
        <circle cx="160" cy="90" r="54" fill={theme.arch} opacity="0.4" />

        {/* Botanical / calligraphy subtle petal curve */}
        <path
          d="M 430,240 C 470,200 520,250 510,290 C 490,330 420,280 430,240 Z"
          fill={theme.secondary}
          opacity="0.7"
        />

        {/* Fine grain overlay */}
        <rect width="600" height="360" filter="url(#subtleGrain)" fill="white" opacity="0.08" />
      </svg>

      {/* Atmospheric bottom gradient transition to blend gently into content below */}
      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/25 to-transparent pointer-events-none" />
    </div>
  );
};
