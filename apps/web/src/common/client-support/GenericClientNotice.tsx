import { BrandedState } from '@/common/components/state/BrandedState';
import { t } from '@/common/i18n/workspace-i18n.logic';

export function GenericClientNotice({
  retryHref = '/login',
  alert = false,
}: {
  retryHref?: string;
  alert?: boolean;
}) {
  return (
    <div
      className="contents"
      data-client-compatibility-notice="generic"
      role={alert ? 'alert' : undefined}
      aria-live={alert ? 'assertive' : undefined}
    >
      <BrandedState
        eyebrow={t('client_notice.eyebrow', 'th')}
        title={t('client_notice.title', 'th')}
        description={t('client_notice.body', 'th')}
      >
        <p className="w-full basis-full text-sm leading-6 text-gray-500">
          <span className="font-semibold text-gray-700">{t('client_notice.title', 'en')}.</span>{' '}
          {t('client_notice.body', 'en')}
        </p>
        <a
          href={retryHref}
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-800"
        >
          {t('client_notice.retry', 'th')} / {t('client_notice.retry', 'en')}
        </a>
        <a
          href="mailto:contact@mangmeeplus.com"
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
        >
          {t('client_notice.contact', 'th')} / {t('client_notice.contact', 'en')}
        </a>
      </BrandedState>
    </div>
  );
}
