import PublicPage from '../../components/PublicPage';
import { ResetPasswordForm } from '../../components/PasswordRecoveryForm';
export default function ResetPasswordPage(){return <PublicPage title="Create a new password" subtitle="Reset links are one-time use and expire after 30 minutes."><ResetPasswordForm/><p className="form-back"><a href="/forgot-password">Request another reset link</a> · <a href="/admin">Administrator sign in</a></p></PublicPage>}
