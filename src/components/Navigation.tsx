import React from 'react';
import { LanguageCode } from '../types/dictionary';
import { LANGUAGES } from '../data/languages';
import {
  Home,
  BookOpen,
  GraduationCap,
  Bookmark,
  Layers,
  Settings,
  Sun,
  Moon,
  Globe2,
} from 'lucide-react';

export type NavigationTab = 'home' | 'dictionary' | 'learn' | 'saved' | 'library';

interface NavigationProps {
  currentTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  interfaceLang: LanguageCode;
  onOpenSettings: () => void;
  theme: 'light' | 'dark' | 'system';
  onToggleTheme: (theme: 'light' | 'dark') => void;
}

export const Navigation: React.FC<NavigationProps> = ({
  currentTab,
  onSelectTab,
  interfaceLang,
  onOpenSettings,
  theme,
  onToggleTheme,
}) => {
  const currentLangMeta = LANGUAGES[interfaceLang];

  // Localized navigation captions
  const tabLabels: Record<NavigationTab, Record<LanguageCode, string>> = {
    home: {
      en: 'Home',
      ha: 'Gida',
      yo: 'Ilé',
      ff: 'Wuro',
      ar: 'الرئيسية',
      fr: 'Accueil',
      zh: '首页',
    },
    dictionary: {
      en: 'Dictionary',
      ha: 'Kamus',
      yo: 'Àtúmọ̀',
      ff: 'Saggitorde',
      ar: 'المعجم',
      fr: 'Dictionnaire',
      zh: '词典',
    },
    learn: {
      en: 'Learn',
      ha: 'Koyi',
      yo: 'Kẹ́kọ̀ọ́',
      ff: 'Jannu',
      ar: 'تعلّم',
      fr: 'Apprendre',
      zh: '学习',
    },
    saved: {
      en: 'Saved',
      ha: 'Ajiye',
      yo: 'Ìpamọ́',
      ff: 'Moofaa',
      ar: 'المحفوظات',
      fr: 'Enregistré',
      zh: '收藏',
    },
    library: {
      en: 'Library',
      ha: 'Ɗakin Littattafai',
      yo: 'Àkójọ',
      ff: 'Defterdu',
      ar: 'المكتبة',
      fr: 'Bibliothèque',
      zh: '语言库',
    },
  };

  const navItems: Array<{ id: NavigationTab; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'home', icon: Home },
    { id: 'dictionary', icon: BookOpen },
    { id: 'learn', icon: GraduationCap },
    { id: 'saved', icon: Bookmark },
    { id: 'library', icon: Layers },
  ];

  return (
    <>
      {/* Top Application Bar (Honors Top Bar Contract on desktop & tablet) */}
      <header className="sticky top-0 z-40 bg-[#FAF8F5]/90 dark:bg-[#122019]/90 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-4">
          {/* Zone 1: Single text element wordmark */}
          <div
            onClick={() => onSelectTab('home')}
            className="flex items-center gap-2 cursor-pointer select-none group shrink-0"
          >
            <div className="w-8 h-8 rounded-xl bg-[#1B382B] dark:bg-[#7E9E88] text-white dark:text-[#122019] flex items-center justify-center font-serif-editorial font-bold text-base shadow-xs group-hover:scale-105 transition-transform">
              L
            </div>
            <span className="font-serif-editorial text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-50 whitespace-nowrap">
              Lexica
            </span>
          </div>

          {/* Zone 2: Desktop 5-zone navigation links */}
          <nav className="hidden md:flex items-center gap-1 sm:gap-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentTab === item.id;
              const label = tabLabels[item.id][interfaceLang] || tabLabels[item.id].en;

              return (
                <button
                  key={item.id}
                  onClick={() => onSelectTab(item.id)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-medium transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                    isActive
                      ? 'bg-[#1B382B] text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Primary actions & settings */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Quick Interface Language Indicator */}
            <button
              onClick={onOpenSettings}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-xs font-semibold cursor-pointer"
              title="Change interface language"
            >
              <Globe2 className="w-3.5 h-3.5 text-[#345E4C] dark:text-[#7E9E88]" />
              <span className="uppercase">{interfaceLang}</span>
            </button>

            {/* Light / Dark Mode Toggle */}
            <button
              onClick={() => onToggleTheme(theme === 'dark' ? 'light' : 'dark')}
              className="p-2 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title={theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4 text-slate-600" />
              )}
            </button>

            {/* Settings Trigger */}
            <button
              onClick={onOpenSettings}
              className="p-2 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title="Open Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Fixed Bottom Navigation Bar (Pattern 1 from Mobile Design Reference) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#FAF8F5]/95 dark:bg-[#122019]/95 backdrop-blur-md border-t border-slate-200/80 dark:border-slate-800 transition-colors shadow-lg">
        <div className="grid grid-cols-5 items-center h-16 pb-safe px-1 max-w-lg mx-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            const label = tabLabels[item.id][interfaceLang] || tabLabels[item.id].en;

            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`flex flex-col items-center justify-center min-h-[44px] min-w-[44px] transition-all cursor-pointer relative py-1 ${
                  isActive
                    ? 'text-[#1B382B] dark:text-[#7E9E88] font-bold'
                    : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                }`}
              >
                <div
                  className={`w-9 h-7 rounded-full flex items-center justify-center transition-colors ${
                    isActive ? 'bg-[#EEF4F0] dark:bg-[#1E3328]' : ''
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'stroke-[2.5]' : 'stroke-[1.75]'}`} />
                </div>
                <span className="text-[10px] tracking-tight mt-0.5 truncate max-w-[58px]">
                  {label}
                </span>
                {isActive && (
                  <span className="w-1 h-1 rounded-full bg-[#1B382B] dark:bg-[#7E9E88] absolute bottom-1" />
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
};
