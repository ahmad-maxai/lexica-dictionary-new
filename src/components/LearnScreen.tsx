import React, { useState } from 'react';
import { LanguageCode } from '../types/dictionary';
import { LANGUAGES } from '../data/languages';
import { dictionaryDb } from '../services/dictionaryDatabase';
import { audioService } from '../services/audioService';
import {
  getUiCopy,
  getContentCopy,
  formatText,
  getLangName,
  getLocalizedPos,
} from '../i18n';
import confetti from 'canvas-confetti';
import {
  GraduationCap,
  RotateCw,
  CheckCircle2,
  XCircle,
  Volume2,
  ChevronRight,
  ChevronLeft,
  Trophy,
  Flame,
} from 'lucide-react';

interface LearnScreenProps {
  interfaceLang: LanguageCode;
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  quizStreak: number;
  totalQuizzesTaken: number;
  totalCardsReviewed: number;
  onRecordQuiz: (score: number, total: number) => void;
  onRecordCardsReviewed: (count: number) => void;
}

export const LearnScreen: React.FC<LearnScreenProps> = ({
  interfaceLang,
  sourceLang,
  targetLang,
  quizStreak,
  totalCardsReviewed,
  onRecordQuiz,
  onRecordCardsReviewed,
}) => {
  const [activeTab, setActiveTab] = useState<'flashcards' | 'quiz'>('flashcards');

  // Flashcards state
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

  // Quiz state
  const [currentQuizIndex, setCurrentQuizIndex] = useState(0);
  const [selectedOptionIndex, setSelectedOptionIndex] = useState<number | null>(null);
  const [isAnswerSubmitted, setIsAnswerSubmitted] = useState(false);
  const [quizScore, setQuizScore] = useState(0);
  const [isQuizCompleted, setIsQuizCompleted] = useState(false);

  const copy = getUiCopy(interfaceLang);
  const content = getContentCopy(interfaceLang);
  const quizQuestions = content.quizQuestions;

  // Prepare cards based on dictionary entries
  const allEntries = dictionaryDb.getAllEntries();
  const pairEntries = allEntries.filter(
    (e) =>
      (e.sourceLang === sourceLang && !!e.translations[targetLang]?.length) ||
      (e.sourceLang === targetLang && !!e.translations[sourceLang]?.length)
  );
  const flashcardList = pairEntries.length > 0 ? pairEntries : allEntries;
  const currentCard = flashcardList.length > 0 ? flashcardList[currentCardIndex % flashcardList.length] : null;
  const sourceMeta = currentCard ? LANGUAGES[currentCard.sourceLang] : LANGUAGES[sourceLang];
  const targetMeta = LANGUAGES[targetLang];
  const targetName = getLangName(targetLang, interfaceLang);
  const currentTranslation = currentCard
    ? currentCard.translations[targetLang]?.[0] || {
        headword:
          currentCard.translations[interfaceLang]?.[0]?.headword ||
          currentCard.definitionEn ||
          currentCard.definition,
        transliteration: '',
        definition: currentCard.definition,
        partOfSpeech: currentCard.partOfSpeech,
      }
    : null;

  const handleNextCard = () => {
    setIsFlipped(false);
    setCurrentCardIndex((prev) => (prev + 1) % flashcardList.length);
    onRecordCardsReviewed(1);
  };

  const handlePrevCard = () => {
    setIsFlipped(false);
    setCurrentCardIndex((prev) => (prev - 1 + flashcardList.length) % flashcardList.length);
  };

  const handleCardSpeak = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentCard) return;
    audioService.speak(currentCard.headword, currentCard.sourceLang, currentCard.tonePattern);
  };

  // Quiz handling
  const currentQuestion = quizQuestions[currentQuizIndex % quizQuestions.length];

  const handleSelectOption = (idx: number) => {
    if (isAnswerSubmitted) return;
    setSelectedOptionIndex(idx);
  };

  const handleSubmitAnswer = () => {
    if (selectedOptionIndex === null || isAnswerSubmitted) return;
    setIsAnswerSubmitted(true);
    const chosen = currentQuestion.options[selectedOptionIndex];
    const isCorrect = chosen === currentQuestion.correctAnswer;
    if (isCorrect) {
      setQuizScore((prev) => prev + 1);
    }
  };

  const handleNextQuestion = () => {
    setSelectedOptionIndex(null);
    setIsAnswerSubmitted(false);
    if (currentQuizIndex + 1 < quizQuestions.length) {
      setCurrentQuizIndex((prev) => prev + 1);
    } else {
      setIsQuizCompleted(true);
      onRecordQuiz(quizScore, quizQuestions.length);
      try {
        confetti({
          particleCount: 80,
          spread: 60,
          origin: { y: 0.6 },
        });
      } catch {}
    }
  };

  const handleRestartQuiz = () => {
    setCurrentQuizIndex(0);
    setSelectedOptionIndex(null);
    setIsAnswerSubmitted(false);
    setQuizScore(0);
    setIsQuizCompleted(false);
  };

  return (
    <div className="pb-24 sm:pb-16 text-slate-900 dark:text-slate-100 max-w-3xl mx-auto px-4 sm:px-6 pt-6 transition-colors">
      {/* Header with Stats Badges */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold font-serif-editorial text-slate-900 dark:text-slate-50 flex items-center gap-2">
            <GraduationCap className="w-6 h-6 text-[#204031] dark:text-[#7E9E88]" />
            <span>{copy.learn.title}</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {copy.learn.subtitle}
          </p>
        </div>

        {/* Minimal Unboxed Metrics */}
        <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-400">
          <div className="flex items-center gap-1.5 font-medium">
            <Flame className="w-4 h-4 text-[#D97753]" />
            <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {quizStreak} {copy.learn.dayUnit}
            </span>
            <span>{copy.learn.streakLabel}</span>
          </div>
          <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
          <div className="flex items-center gap-1.5 font-medium">
            <Trophy className="w-4 h-4 text-[#C99E5C]" />
            <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {totalCardsReviewed}
            </span>
            <span>{copy.learn.reviewedLabel}</span>
          </div>
        </div>
      </div>

      {/* Mode Navigation Tabs */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-200/60 dark:bg-[#162720] rounded-xl mb-6">
        <button
          onClick={() => setActiveTab('flashcards')}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
            activeTab === 'flashcards'
              ? 'bg-white dark:bg-[#1F372C] text-slate-900 dark:text-slate-50 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
          }`}
        >
          {copy.learn.spacedFlashcards}
        </button>
        <button
          onClick={() => setActiveTab('quiz')}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
            activeTab === 'quiz'
              ? 'bg-white dark:bg-[#1F372C] text-slate-900 dark:text-slate-50 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
          }`}
        >
          {copy.learn.diacriticQuiz}
        </button>
      </div>

      {/* --- TAB 1: FLASHCARDS --- */}
      {activeTab === 'flashcards' && (!currentCard || !currentTranslation) && (
        <div className="p-8 rounded-3xl bg-white dark:bg-[#15231D] border border-dashed border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500">
          {copy.learn.noPacksActive}
        </div>
      )}
      {activeTab === 'flashcards' && currentCard && currentTranslation && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>
              {formatText(copy.learn.cardOf, {
                current: currentCardIndex + 1,
                total: flashcardList.length,
              })}
            </span>
            <span>{copy.learn.tapToReveal}</span>
          </div>

          {/* 3D Interactive Card Flip Container */}
          <div
            onClick={() => setIsFlipped(!isFlipped)}
            className="w-full min-h-[320px] rounded-3xl bg-white dark:bg-[#15231D] border border-slate-200/90 dark:border-slate-800 p-7 shadow-md flex flex-col justify-between cursor-pointer select-none transition-all duration-300 relative group overflow-hidden"
          >
            {/* Cultural subtle tint header */}
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-[#204031] text-white">
                  {sourceMeta.code.toUpperCase()} · {getLangName(sourceMeta.code, interfaceLang)}
                </span>
                <span dir="ltr" className="text-xs text-slate-500 font-mono">{currentCard.ipa}</span>
              </div>

              <button
                type="button"
                onClick={handleCardSpeak}
                className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
                title={copy.common.pronounce}
              >
                <Volume2 className="w-4 h-4" />
              </button>
            </div>

            {/* Card Body - Front / Back Content */}
            <div className="py-6 text-center my-auto">
              {!isFlipped ? (
                <div>
                  <div
                    className={`text-4xl sm:text-5xl font-bold tracking-tight text-slate-900 dark:text-slate-50 ${
                      sourceMeta.direction === 'rtl' ? 'font-arabic' : 'font-serif-editorial'
                    }`}
                    dir={sourceMeta.direction}
                  >
                    {currentCard.headword}
                  </div>

                  {currentCard.headwordScriptVariant && (
                    <div className="text-xs text-[#C47248] font-medium mt-2">
                      {currentCard.headwordScriptVariant.label}: {currentCard.headwordScriptVariant.text}
                    </div>
                  )}

                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 italic">
                    {getLocalizedPos(currentCard.partOfSpeech, interfaceLang)}
                  </div>

                  <div className="mt-6 flex items-center justify-center gap-1 text-xs text-slate-400">
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>{formatText(copy.learn.flipToSeeTranslation, { target: targetName })}</span>
                  </div>
                </div>
              ) : (
                <div className="animate-in fade-in duration-200">
                  <div className="text-xs font-bold uppercase tracking-wider text-[#345E4C] dark:text-[#7E9E88] mb-1">
                    {formatText(copy.learn.translationHeading, { target: targetName })}
                  </div>

                  <div
                    className={`text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50 ${
                      targetMeta.direction === 'rtl' ? 'font-arabic' : 'font-serif-editorial'
                    }`}
                    dir={targetMeta.direction}
                  >
                    {currentTranslation.headword}
                  </div>

                  <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 max-w-md mx-auto mt-3 leading-relaxed">
                    {currentCard.definition}
                  </p>

                  {currentCard.culturalNote && (
                    <div className="mt-4 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/50 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-400 max-w-sm mx-auto">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {copy.learn.culturalInsight}{' '}
                      </span>
                      {currentCard.culturalNote}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Bottom Card Navigation Action Buttons */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800/80">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePrevCard();
                }}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1 cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5 rtl:rotate-180" />
                <span>{copy.learn.previous}</span>
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsFlipped(!isFlipped);
                }}
                className="text-xs font-medium text-[#345E4C] dark:text-[#7E9E88] flex items-center gap-1"
              >
                <RotateCw className="w-3 h-3" />
                <span>{isFlipped ? copy.learn.showTerm : copy.learn.showMeaning}</span>
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleNextCard();
                }}
                className="px-3.5 py-1.5 rounded-xl bg-[#1B382B] text-white text-xs font-semibold hover:bg-[#142A20] flex items-center gap-1 cursor-pointer shadow-xs"
              >
                <span>{copy.learn.nextCard}</span>
                <ChevronRight className="w-3.5 h-3.5 rtl:rotate-180" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- TAB 2: QUIZ & DIACRITIC EXERCISE --- */}
      {activeTab === 'quiz' && (
        <div>
          {!isQuizCompleted ? (
            <div className="bg-white dark:bg-[#15231D] rounded-3xl p-6 border border-slate-200/90 dark:border-slate-800 shadow-sm space-y-5">
              {/* Quiz Progress Header */}
              <div className="flex items-center justify-between text-xs text-slate-500 pb-3 border-b border-slate-100 dark:border-slate-800">
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {formatText(copy.learn.questionOf, {
                    current: currentQuizIndex + 1,
                    total: quizQuestions.length,
                  })}
                </span>
                <span className="font-mono">
                  {formatText(copy.learn.scoreLabel, {
                    score: quizScore,
                    answered: currentQuizIndex + (isAnswerSubmitted ? 1 : 0),
                  })}
                </span>
              </div>

              {/* Question Body */}
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#C47248] block mb-1">
                  {currentQuestion.prompt}
                </span>

                <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-50 leading-snug">
                  {currentQuestion.question}
                </h3>

                {currentQuestion.phoneticHint && (
                  <div dir="ltr" className="text-xs text-slate-500 font-mono mt-1 inline-block">
                    {copy.learn.hintPrefix} {currentQuestion.phoneticHint}
                  </div>
                )}
              </div>

              {/* Options List */}
              <div className="space-y-2.5">
                {currentQuestion.options.map((option, idx) => {
                  const isSelected = selectedOptionIndex === idx;
                  const isCorrect = option === currentQuestion.correctAnswer;

                  let optionStyle =
                    'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#192A22] text-slate-800 dark:text-slate-200 hover:border-slate-300';

                  if (isAnswerSubmitted) {
                    if (isCorrect) {
                      optionStyle = 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 font-medium';
                    } else if (isSelected && !isCorrect) {
                      optionStyle = 'border-rose-500 bg-rose-50 dark:bg-rose-950/40 text-rose-900 dark:text-rose-200';
                    }
                  } else if (isSelected) {
                    optionStyle = 'border-[#204031] dark:border-[#7E9E88] bg-[#EEF4F0] dark:bg-[#1E3328] text-slate-900 dark:text-slate-50 font-medium';
                  }

                  return (
                    <button
                      key={idx}
                      type="button"
                      disabled={isAnswerSubmitted}
                      onClick={() => handleSelectOption(idx)}
                      className={`w-full text-start p-3.5 rounded-2xl border text-xs sm:text-sm transition-all flex items-start gap-3 cursor-pointer ${optionStyle}`}
                    >
                      <div className="w-5 h-5 rounded-full border flex items-center justify-center shrink-0 text-xs font-mono mt-0.5">
                        {String.fromCharCode(65 + idx)}
                      </div>
                      <span className="flex-1 leading-relaxed">{option}</span>
                      {isAnswerSubmitted && isCorrect && (
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                      )}
                      {isAnswerSubmitted && isSelected && !isCorrect && (
                        <XCircle className="w-5 h-5 text-rose-600 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Explanation Banner */}
              {isAnswerSubmitted && (
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-[#182A22] border border-slate-200 dark:border-slate-800 text-xs leading-relaxed animate-in fade-in">
                  <div className="font-bold text-slate-900 dark:text-slate-100 mb-1">
                    {copy.learn.linguisticRationale}
                  </div>
                  <p className="text-slate-700 dark:text-slate-300">
                    {currentQuestion.explanation}
                  </p>
                </div>
              )}

              {/* Bottom Action */}
              <div className="pt-2 flex justify-end">
                {!isAnswerSubmitted ? (
                  <button
                    type="button"
                    disabled={selectedOptionIndex === null}
                    onClick={handleSubmitAnswer}
                    className="h-11 px-6 rounded-xl bg-[#1B382B] text-white text-xs font-semibold hover:bg-[#142A20] disabled:opacity-50 disabled:pointer-events-none transition-all cursor-pointer shadow-xs"
                  >
                    {copy.learn.checkAnswer}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleNextQuestion}
                    className="h-11 px-6 rounded-xl bg-[#1B382B] text-white text-xs font-semibold hover:bg-[#142A20] transition-all cursor-pointer shadow-xs flex items-center gap-1.5"
                  >
                    <span>
                      {currentQuizIndex + 1 < quizQuestions.length
                        ? copy.learn.nextQuestion
                        : copy.learn.completeQuiz}
                    </span>
                    <ChevronRight className="w-4 h-4 rtl:rotate-180" />
                  </button>
                )}
              </div>
            </div>
          ) : (
            /* Quiz Completed Celebration Screen */
            <div className="bg-white dark:bg-[#15231D] rounded-3xl p-8 border border-slate-200/90 dark:border-slate-800 text-center space-y-4 shadow-md">
              <div className="w-16 h-16 rounded-2xl bg-[#EEF4F0] dark:bg-[#1F372C] text-[#204031] dark:text-[#7E9E88] flex items-center justify-center mx-auto">
                <Trophy className="w-8 h-8 text-[#C99E5C]" />
              </div>

              <h2 className="text-2xl font-bold font-serif-editorial text-slate-900 dark:text-slate-50">
                {copy.learn.sessionCompleted}
              </h2>

              <p className="text-sm text-slate-600 dark:text-slate-400 max-w-sm mx-auto">
                {formatText(copy.learn.quizScoreSummary, {
                  score: quizScore,
                  total: quizQuestions.length,
                })}
              </p>

              <div className="pt-4 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={handleRestartQuiz}
                  className="px-5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all cursor-pointer"
                >
                  {copy.learn.retakeQuiz}
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('flashcards')}
                  className="px-6 py-2.5 rounded-xl bg-[#1B382B] text-white text-xs font-semibold hover:bg-[#142A20] transition-all cursor-pointer shadow-xs"
                >
                  {copy.learn.reviewFlashcards}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
