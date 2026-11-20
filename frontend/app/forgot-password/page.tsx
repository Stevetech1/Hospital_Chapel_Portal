import PublicPage from '../../components/PublicPage';
import { ForgotPasswordForm } from '../../components/PasswordRecoveryForm';
export default function ForgotPasswordPage(){return <PublicPage title="Forgot your password?" subtitle="Enter the email address linked to your Hospital Chapel account. If an active account exists, we will send a secure reset link."><ForgotPasswordForm/><p className="form-back"><a href="/admin">Return to administrator sign in</a> · <a href="/member-portal">Member sign in</a></p></PublicPage>}
