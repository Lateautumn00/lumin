export {
  locateSoffice,
  parseRegistryInstallPath,
  probeSofficeDir,
  queryRegistryInstallPath,
  REG_HKCU,
  REG_HKLM
} from './locate'
export type { FileExists, LocateResult, LocateSource, QueryRegistry } from './locate'
export {
  buildConvertArgs,
  classifyConvertFailure,
  convertDetail,
  isLoadFailure,
  moveFile,
  pickSofficeCommand,
  precheckInput,
  producedPdfPath,
  taskWorkDir,
  toFileUrl,
  verifyPdfOutput
} from './convert'
export type { ConvertFailureKind, MoveFs, PrecheckDeps, PrecheckOutcome } from './convert'
export { createMutex, sofficeMutex } from './mutex'
export type { Mutex } from './mutex'
