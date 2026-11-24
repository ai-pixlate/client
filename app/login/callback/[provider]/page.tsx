import { SocialCallbackView } from './social-callback-view';

function firstValue(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value;
  return Array.isArray(value) ? (value[0] ?? null) : null;
}

/**
 * 소셜 제공자 콜백 /login/callback/{provider}?code&state. 완료 요청은 클라이언트에서 한 번만 보낸다(social-callback-view).
 * /auth/* rewrite 와 겹치지 않도록 /login 아래에 둔다.
 */
export default async function SocialCallbackPage({
  params,
  searchParams,
}: {
  params: Promise<{ provider: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { provider } = await params;
  const query = await searchParams;
  return (
    <SocialCallbackView
      provider={provider}
      code={firstValue(query.code)}
      state={firstValue(query.state)}
      providerError={firstValue(query.error)}
    />
  );
}
