-- AlterTable
ALTER TABLE "reputation_items" ADD COLUMN     "detectedLanguage" TEXT,
ADD COLUMN     "isMixedLanguage" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "languageConfidence" DOUBLE PRECISION,
ADD COLUMN     "languageDetectionSource" TEXT,
ADD COLUMN     "riskExplanation" JSONB,
ADD COLUMN     "translatedText" TEXT,
ADD COLUMN     "translatedToLocale" TEXT,
ADD COLUMN     "translationProvider" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "translationStatus" TEXT NOT NULL DEFAULT 'not_needed';
