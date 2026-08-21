-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "IdeaStatus" AS ENUM ('IDEA', 'RESEARCH', 'SCRIPT', 'ASSETS', 'VOICE', 'EDITING', 'REVIEW', 'READY', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT');

-- CreateEnum
CREATE TYPE "ContentGoal" AS ENUM ('VIRALITY', 'AFFILIATE', 'EDUCATION', 'ENTERTAINMENT', 'CONVERSION');

-- CreateEnum
CREATE TYPE "ScriptStyle" AS ENUM ('EDUCATIONAL', 'VIRAL', 'STORYTELLING', 'DIRECT', 'MYSTERIOUS');

-- CreateEnum
CREATE TYPE "ScriptSection" AS ENUM ('HOOK', 'PROBLEM', 'SOLUTION', 'RESULT', 'CTA');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('VERIFIED', 'UNVERIFIED', 'OPINION', 'SAFETY_WARNING');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('VIDEO', 'IMAGE', 'AUDIO');

-- CreateEnum
CREATE TYPE "AssetSource" AS ENUM ('OWNED', 'LICENSED', 'AI_GENERATED', 'PUBLIC_DOMAIN', 'EXTERNAL_REFERENCE');

-- CreateEnum
CREATE TYPE "CommercialUse" AS ENUM ('ALLOWED', 'DENIED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RightsStatus" AS ENUM ('CLEARED', 'NEEDS_REVIEW', 'BLOCKED');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('TIKTOK', 'YOUTUBE_SHORTS', 'INSTAGRAM_REELS', 'SNAPCHAT_SPOTLIGHT');

-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('DRAFT', 'STORYBOARD', 'VOICE', 'RENDERING', 'RENDERED', 'REVIEW', 'READY', 'SCHEDULED', 'PUBLISHED', 'FAILED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('DRAFT', 'READY', 'SCHEDULED', 'PUBLISHED', 'FAILED', 'MANUAL_REQUIRED');

-- CreateEnum
CREATE TYPE "CaptionStyle" AS ENUM ('MINIMAL', 'BOLD', 'HIGHLIGHTED', 'KARAOKE', 'CENTERED');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('GENERATE_IDEAS', 'GENERATE_SCRIPT', 'GENERATE_STORYBOARD', 'GENERATE_VOICE', 'GENERATE_VIDEO', 'GENERATE_CAPTIONS', 'RENDER_VIDEO', 'ANALYZE_VIDEO', 'PUBLISH_VIDEO', 'FETCH_ANALYTICS', 'FACT_CHECK');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TrendKind" AS ENUM ('TOPIC', 'KEYWORD', 'HASHTAG', 'TITLE', 'FORMAT', 'QUESTION', 'SEASONAL');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('CANDIDATE', 'ACTIVE', 'PAUSED', 'REJECTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'fr',
    "niche" TEXT NOT NULL DEFAULT 'DIY / bricolage / maison',
    "aiBudgetCentsMonthly" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'OWNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "handle" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'fr',
    "audience" TEXT,
    "tone" TEXT,
    "defaultHashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferredVoiceId" TEXT,
    "logoAssetId" TEXT,
    "watermarkAssetId" TEXT,
    "requireMinDuration" BOOLEAN NOT NULL DEFAULT false,
    "minDurationSec" INTEGER NOT NULL DEFAULT 60,
    "oauthPayload" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Idea" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "hook" TEXT,
    "concept" TEXT,
    "summary" TEXT,
    "cta" TEXT,
    "category" TEXT NOT NULL DEFAULT 'DIY',
    "subcategory" TEXT,
    "difficulty" "Difficulty" NOT NULL DEFAULT 'BEGINNER',
    "estimatedCostCents" INTEGER NOT NULL DEFAULT 0,
    "goal" "ContentGoal" NOT NULL DEFAULT 'VIRALITY',
    "status" "IdeaStatus" NOT NULL DEFAULT 'IDEA',
    "targetDurationSec" INTEGER NOT NULL DEFAULT 45,
    "language" TEXT NOT NULL DEFAULT 'fr',
    "viralScore" INTEGER NOT NULL DEFAULT 0,
    "originalityScore" INTEGER NOT NULL DEFAULT 0,
    "productionScore" INTEGER NOT NULL DEFAULT 0,
    "affiliateScore" INTEGER NOT NULL DEFAULT 0,
    "safetyScore" INTEGER NOT NULL DEFAULT 100,
    "sources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT NOT NULL DEFAULT '',
    "duplicatedFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Idea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Script" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ideaId" TEXT NOT NULL,
    "style" "ScriptStyle" NOT NULL DEFAULT 'VIRAL',
    "language" TEXT NOT NULL DEFAULT 'fr',
    "platform" "Platform",
    "targetDurationSec" INTEGER NOT NULL DEFAULT 45,
    "audience" TEXT,
    "technicalLevel" "Difficulty" NOT NULL DEFAULT 'BEGINNER',
    "isSelected" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "fullText" TEXT NOT NULL DEFAULT '',
    "similarityScore" INTEGER,
    "similarityMethod" TEXT,
    "similarToScriptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Script_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScriptBlock" (
    "id" TEXT NOT NULL,
    "scriptId" TEXT NOT NULL,
    "section" "ScriptSection" NOT NULL,
    "order" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "visualDirection" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScriptBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactClaim" (
    "id" TEXT NOT NULL,
    "scriptId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "safetyTopic" TEXT,
    "rationale" TEXT,
    "sourceUrl" TEXT,
    "humanReviewed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "source" "AssetSource" NOT NULL,
    "name" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "thumbnailKey" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "fps" DOUBLE PRECISION,
    "checksum" TEXT,
    "author" TEXT,
    "sourceUrl" TEXT,
    "license" TEXT,
    "licenseProofKey" TEXT,
    "acquiredAt" TIMESTAMP(3),
    "commercialUse" "CommercialUse" NOT NULL DEFAULT 'UNKNOWN',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RightsRecord" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "owner" TEXT,
    "license" TEXT,
    "proofKey" TEXT,
    "proofUrl" TEXT,
    "expiresAt" TIMESTAMP(3),
    "commercialUse" "CommercialUse" NOT NULL DEFAULT 'UNKNOWN',
    "territory" TEXT NOT NULL DEFAULT 'WORLDWIDE',
    "restrictions" TEXT NOT NULL DEFAULT '',
    "status" "RightsStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RightsRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Music" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "bpm" INTEGER,
    "mood" TEXT,
    "license" TEXT,
    "commercialUse" "CommercialUse" NOT NULL DEFAULT 'UNKNOWN',
    "source" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Music_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceTrack" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "videoId" TEXT,
    "provider" TEXT NOT NULL,
    "voiceId" TEXT NOT NULL,
    "voiceName" TEXT,
    "language" TEXT NOT NULL DEFAULT 'fr',
    "speed" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "stability" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "tone" TEXT,
    "text" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'mp3',
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "structure" JSONB NOT NULL,
    "targetDurationSec" INTEGER NOT NULL DEFAULT 45,
    "captionStyle" "CaptionStyle" NOT NULL DEFAULT 'BOLD',
    "captionPosition" TEXT NOT NULL DEFAULT 'center',
    "captionFont" TEXT NOT NULL DEFAULT 'DejaVu Sans',
    "captionSizePx" INTEGER NOT NULL DEFAULT 72,
    "captionPrimaryColor" TEXT NOT NULL DEFAULT '#FFFFFF',
    "captionAccentColor" TEXT NOT NULL DEFAULT '#FFD400',
    "transition" TEXT NOT NULL DEFAULT 'fade',
    "musicMood" TEXT,
    "introEnabled" BOOLEAN NOT NULL DEFAULT false,
    "outroEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ideaId" TEXT,
    "scriptId" TEXT,
    "templateId" TEXT,
    "musicId" TEXT,
    "title" TEXT NOT NULL,
    "status" "VideoStatus" NOT NULL DEFAULT 'DRAFT',
    "targetDurationSec" INTEGER NOT NULL DEFAULT 45,
    "fps" INTEGER NOT NULL DEFAULT 30,
    "width" INTEGER NOT NULL DEFAULT 1080,
    "height" INTEGER NOT NULL DEFAULT 1920,
    "captionStyle" "CaptionStyle" NOT NULL DEFAULT 'BOLD',
    "monetizationReady" BOOLEAN NOT NULL DEFAULT false,
    "watermarkEnabled" BOOLEAN NOT NULL DEFAULT false,
    "musicVolume" DOUBLE PRECISION NOT NULL DEFAULT 0.18,
    "masterKey" TEXT,
    "thumbnailKey" TEXT,
    "renderedDurationMs" INTEGER,
    "costVoiceCents" INTEGER NOT NULL DEFAULT 0,
    "costVideoAiCents" INTEGER NOT NULL DEFAULT 0,
    "costLlmCents" INTEGER NOT NULL DEFAULT 0,
    "costStorageCents" INTEGER NOT NULL DEFAULT 0,
    "estimatedRevenueCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scene" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "section" "ScriptSection" NOT NULL DEFAULT 'SOLUTION',
    "startMs" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "narration" TEXT NOT NULL DEFAULT '',
    "visualPrompt" TEXT NOT NULL DEFAULT '',
    "caption" TEXT NOT NULL DEFAULT '',
    "transition" TEXT NOT NULL DEFAULT 'fade',
    "zoom" DOUBLE PRECISION NOT NULL DEFAULT 1.08,
    "assetId" TEXT,
    "assetTrimStartMs" INTEGER,
    "assetTrimEndMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scene_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoVersion" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cta" TEXT NOT NULL DEFAULT '',
    "storageKey" TEXT,
    "durationMs" INTEGER,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptionTrack" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "style" "CaptionStyle" NOT NULL DEFAULT 'BOLD',
    "language" TEXT NOT NULL DEFAULT 'fr',
    "storageKey" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'estimated',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaptionTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityReport" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "checks" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Publication" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "videoVersionId" TEXT,
    "socialAccountId" TEXT,
    "platform" "Platform" NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "externalId" TEXT,
    "externalUrl" TEXT,
    "caption" TEXT NOT NULL DEFAULT '',
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "failureReason" TEXT,
    "manualReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Analytics" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "publicationId" TEXT,
    "platform" "Platform" NOT NULL,
    "measuredOn" TIMESTAMP(3) NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "followersGained" INTEGER NOT NULL DEFAULT 0,
    "avgWatchMs" INTEGER NOT NULL DEFAULT 0,
    "completionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "engagementRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "revenueCents" INTEGER NOT NULL DEFAULT 0,
    "contentScore" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Analytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "url" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "category" TEXT,
    "commissionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "platform" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'CANDIDATE',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateLink" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "videoId" TEXT,
    "affiliateUrl" TEXT NOT NULL,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "revenueCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trend" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "TrendKind" NOT NULL,
    "value" TEXT NOT NULL,
    "platform" "Platform",
    "weight" INTEGER NOT NULL DEFAULT 0,
    "season" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "notes" TEXT NOT NULL DEFAULT '',
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Trend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TagOnIdea" (
    "ideaId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "TagOnIdea_pkey" PRIMARY KEY ("ideaId","tagId")
);

-- CreateTable
CREATE TABLE "AIJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "entityType" TEXT,
    "entityId" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "promptVersion" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "input" JSONB,
    "result" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE INDEX "Workspace_deletedAt_idx" ON "Workspace"("deletedAt");

-- CreateIndex
CREATE INDEX "WorkspaceMember_workspaceId_idx" ON "WorkspaceMember"("workspaceId");

-- CreateIndex
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_userId_workspaceId_key" ON "WorkspaceMember"("userId", "workspaceId");

-- CreateIndex
CREATE INDEX "SocialAccount_workspaceId_idx" ON "SocialAccount"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_workspaceId_platform_handle_key" ON "SocialAccount"("workspaceId", "platform", "handle");

-- CreateIndex
CREATE INDEX "Idea_workspaceId_status_idx" ON "Idea"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Idea_workspaceId_deletedAt_idx" ON "Idea"("workspaceId", "deletedAt");

-- CreateIndex
CREATE INDEX "Idea_workspaceId_createdAt_idx" ON "Idea"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Idea_category_idx" ON "Idea"("category");

-- CreateIndex
CREATE INDEX "Script_workspaceId_idx" ON "Script"("workspaceId");

-- CreateIndex
CREATE INDEX "Script_ideaId_idx" ON "Script"("ideaId");

-- CreateIndex
CREATE INDEX "Script_workspaceId_isSelected_idx" ON "Script"("workspaceId", "isSelected");

-- CreateIndex
CREATE INDEX "ScriptBlock_scriptId_order_idx" ON "ScriptBlock"("scriptId", "order");

-- CreateIndex
CREATE INDEX "FactClaim_scriptId_idx" ON "FactClaim"("scriptId");

-- CreateIndex
CREATE INDEX "FactClaim_status_idx" ON "FactClaim"("status");

-- CreateIndex
CREATE INDEX "Asset_workspaceId_kind_idx" ON "Asset"("workspaceId", "kind");

-- CreateIndex
CREATE INDEX "Asset_workspaceId_source_idx" ON "Asset"("workspaceId", "source");

-- CreateIndex
CREATE INDEX "Asset_workspaceId_deletedAt_idx" ON "Asset"("workspaceId", "deletedAt");

-- CreateIndex
CREATE INDEX "Asset_commercialUse_idx" ON "Asset"("commercialUse");

-- CreateIndex
CREATE UNIQUE INDEX "RightsRecord_assetId_key" ON "RightsRecord"("assetId");

-- CreateIndex
CREATE INDEX "RightsRecord_workspaceId_status_idx" ON "RightsRecord"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Music_workspaceId_commercialUse_idx" ON "Music"("workspaceId", "commercialUse");

-- CreateIndex
CREATE INDEX "Music_workspaceId_deletedAt_idx" ON "Music"("workspaceId", "deletedAt");

-- CreateIndex
CREATE INDEX "VoiceTrack_workspaceId_idx" ON "VoiceTrack"("workspaceId");

-- CreateIndex
CREATE INDEX "VoiceTrack_videoId_idx" ON "VoiceTrack"("videoId");

-- CreateIndex
CREATE INDEX "Template_workspaceId_idx" ON "Template"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Template_workspaceId_key_key" ON "Template"("workspaceId", "key");

-- CreateIndex
CREATE INDEX "Video_workspaceId_status_idx" ON "Video"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Video_workspaceId_deletedAt_idx" ON "Video"("workspaceId", "deletedAt");

-- CreateIndex
CREATE INDEX "Video_ideaId_idx" ON "Video"("ideaId");

-- CreateIndex
CREATE INDEX "Video_scriptId_idx" ON "Video"("scriptId");

-- CreateIndex
CREATE INDEX "Scene_videoId_order_idx" ON "Scene"("videoId", "order");

-- CreateIndex
CREATE INDEX "Scene_assetId_idx" ON "Scene"("assetId");

-- CreateIndex
CREATE INDEX "VideoVersion_videoId_idx" ON "VideoVersion"("videoId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoVersion_videoId_platform_key" ON "VideoVersion"("videoId", "platform");

-- CreateIndex
CREATE INDEX "CaptionTrack_videoId_idx" ON "CaptionTrack"("videoId");

-- CreateIndex
CREATE UNIQUE INDEX "CaptionTrack_videoId_format_style_key" ON "CaptionTrack"("videoId", "format", "style");

-- CreateIndex
CREATE INDEX "QualityReport_videoId_createdAt_idx" ON "QualityReport"("videoId", "createdAt");

-- CreateIndex
CREATE INDEX "Publication_videoId_idx" ON "Publication"("videoId");

-- CreateIndex
CREATE INDEX "Publication_status_scheduledAt_idx" ON "Publication"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Publication_platform_idx" ON "Publication"("platform");

-- CreateIndex
CREATE INDEX "Analytics_videoId_idx" ON "Analytics"("videoId");

-- CreateIndex
CREATE INDEX "Analytics_platform_measuredOn_idx" ON "Analytics"("platform", "measuredOn");

-- CreateIndex
CREATE UNIQUE INDEX "Analytics_publicationId_measuredOn_key" ON "Analytics"("publicationId", "measuredOn");

-- CreateIndex
CREATE INDEX "Product_workspaceId_status_idx" ON "Product"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "AffiliateLink_productId_idx" ON "AffiliateLink"("productId");

-- CreateIndex
CREATE INDEX "AffiliateLink_videoId_idx" ON "AffiliateLink"("videoId");

-- CreateIndex
CREATE INDEX "Trend_workspaceId_kind_idx" ON "Trend"("workspaceId", "kind");

-- CreateIndex
CREATE INDEX "Trend_workspaceId_deletedAt_idx" ON "Trend"("workspaceId", "deletedAt");

-- CreateIndex
CREATE INDEX "Tag_workspaceId_idx" ON "Tag"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_workspaceId_name_key" ON "Tag"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "TagOnIdea_tagId_idx" ON "TagOnIdea"("tagId");

-- CreateIndex
CREATE INDEX "AIJob_workspaceId_type_idx" ON "AIJob"("workspaceId", "type");

-- CreateIndex
CREATE INDEX "AIJob_workspaceId_status_idx" ON "AIJob"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "AIJob_entityType_entityId_idx" ON "AIJob"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AIJob_createdAt_idx" ON "AIJob"("createdAt");

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Idea" ADD CONSTRAINT "Idea_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Script" ADD CONSTRAINT "Script_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Script" ADD CONSTRAINT "Script_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScriptBlock" ADD CONSTRAINT "ScriptBlock_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "Script"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactClaim" ADD CONSTRAINT "FactClaim_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "Script"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RightsRecord" ADD CONSTRAINT "RightsRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RightsRecord" ADD CONSTRAINT "RightsRecord_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Music" ADD CONSTRAINT "Music_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceTrack" ADD CONSTRAINT "VoiceTrack_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceTrack" ADD CONSTRAINT "VoiceTrack_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "Script"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_musicId_fkey" FOREIGN KEY ("musicId") REFERENCES "Music"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoVersion" ADD CONSTRAINT "VideoVersion_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptionTrack" ADD CONSTRAINT "CaptionTrack_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityReport" ADD CONSTRAINT "QualityReport_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_videoVersionId_fkey" FOREIGN KEY ("videoVersionId") REFERENCES "VideoVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analytics" ADD CONSTRAINT "Analytics_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analytics" ADD CONSTRAINT "Analytics_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateLink" ADD CONSTRAINT "AffiliateLink_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateLink" ADD CONSTRAINT "AffiliateLink_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trend" ADD CONSTRAINT "Trend_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagOnIdea" ADD CONSTRAINT "TagOnIdea_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagOnIdea" ADD CONSTRAINT "TagOnIdea_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIJob" ADD CONSTRAINT "AIJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
