/**
 * Core Module Barrel Export
 * Exports all core functionality for easy importing.
 */

// MARK: - API
export { forgeApi, ForgeAPIClient } from './api/forgeApiClient';
export { ForgeAPIError, ForgeAPIErrorCode, isForgeAPIError, getErrorMessage } from './api/apiErrors';

// MARK: - Models
export * from './models/models';
export * from './models/apiModels';
export * from './models/communityModels';
export * from './models/modelExtensions';

// MARK: - Services
export { config, ConfigService } from './services/configService';
export {
  useAuthState,
  useCurrentUser,
  useSignOut,
  useAuth,
  useUser,
  useClerk,
  useSession,
  SignIn,
  SignUp,
  SignedIn,
  SignedOut,
  UserButton,
} from './services/authService';
export type { AuthState, UserInfo } from './services/authService';

// MARK: - Hooks
export {
  useProfile,
  useUpdateProfileMutation,
  useUploadAvatarMutation,
  profileKeys,
  useFeedQuery,
} from './hooks';
export type { FeedItem, UseFeedResult, FetchPage, MapItem } from './hooks';
