"use strict";

const DEFAULT_CREATOR_ID = "serenity";

function normalizeCreatorId(value) {
  const normalized = String(value || DEFAULT_CREATOR_ID).trim().toLowerCase();
  return normalized || DEFAULT_CREATOR_ID;
}

function creatorIdOf(value) {
  return normalizeCreatorId(value?.creatorId || DEFAULT_CREATOR_ID);
}

function scopedKey(value, ...parts) {
  return [creatorIdOf(value), ...parts].join("|");
}

function legacyCompatibleId(baseId, creatorId) {
  const normalized = normalizeCreatorId(creatorId);
  return normalized === DEFAULT_CREATOR_ID ? baseId : `${normalized}-${baseId}`;
}

module.exports = {
  DEFAULT_CREATOR_ID,
  normalizeCreatorId,
  creatorIdOf,
  scopedKey,
  legacyCompatibleId,
};
