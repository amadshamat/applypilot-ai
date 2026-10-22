export { scanForm, type ScanOptions } from './scan';
export { fillForm, type FillOptions } from './fill';
export {
  FIELD_KINDS,
  classifyField,
  isQuestionLike,
  type Classification,
  type DatePart,
  type FieldKind,
} from './classify';
export { matchOption, degreeLevel, US_STATES, MONTHS, type OptionMatch } from './options';
export {
  parseLocation,
  proposeAnswers,
  proposeField,
  toFillAction,
  toInstruction,
  type Proposal,
  type ProposalStatus,
  type ProposedValue,
  type ProposeContext,
  type ResumeFileInfo,
} from './propose';
export { PLATFORMS, detectFormPlatform, type PlatformInfo, type SupportStatus } from './platforms';
export { REF_ATTRIBUTE, isSubmitLike } from './dom';
export { MAX_AI_FIELDS, aiClassifications, buildMappingRequest, type AiMappingRequest } from './ai';
