const MAX_LENGTH = 2000;

const SCAFFOLD =
  ", subject placed on one third of the frame, the other two thirds quiet, softly blurred negative space reserved for typography, minimal uncluttered background, premium clean composition, lighting suited to the subject";

export function buildArtworkPrompt(userPrompt: string, styleSuffix?: string): string {
  const suffix = styleSuffix ? `. ${styleSuffix}` : "";
  const full = `${userPrompt}${SCAFFOLD}${suffix}`;
  if (full.length <= MAX_LENGTH) return full;
  const withoutScaffold = `${userPrompt}${suffix}`;
  if (withoutScaffold.length <= MAX_LENGTH) return withoutScaffold;
  if (userPrompt.length <= MAX_LENGTH) return userPrompt;
  return userPrompt.slice(0, MAX_LENGTH);
}
