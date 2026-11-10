import { LoginView } from './_components/login-view';

// G1 로그인 (Figma 835:6511). 인증 API 는 next.config.ts 의 /auth/* rewrite 를 쓰므로 페이지는 /login 에 둔다.
export default function LoginPage() {
  return <LoginView />;
}
