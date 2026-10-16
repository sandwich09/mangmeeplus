import { BrandedState } from '@/common/components/state/BrandedState';
import { primaryButtonClass, secondaryButtonClass } from '@/common/components/button/button-classes';
import { t } from '@/common/i18n/workspace-i18n.logic';

/**
 * Two different things stop the app from opening, and they must never borrow each other's words
 * (thai-ux-standard §6.2: a system failure is not shown as the person's mistake):
 *
 * - `device` (default): the browser or LINE is too old. The page may be read before any language
 *   can be known, so it stays in Thai and English.
 * - `service`: our own server did not answer. Nothing is wrong with the person's phone, and the
 *   page that shows it knows the language.
 */
// Plain CSS on purpose, no measuring component: the device notice must be whole in the server's
// HTML for a browser too old to run the app. One width for both buttons; the acting one is on top
// when they stack. The service pair is short enough to sit side by side from 640 px (acting button
// at the right); the device pair carries two languages and always stacks.
const pairClass = 'grid w-full gap-3 sm:grid-cols-2';
const stackClass = 'grid w-full gap-3';

export function GenericClientNotice({
  retryHref = '/login',
  alert = false,
  reason = 'device',
  locale = 'th',
}: {
  retryHref?: string;
  alert?: boolean;
  reason?: 'device' | 'service';
  locale?: 'th' | 'en';
}) {
  const service = reason === 'service';
  return (
    <div
      className="contents"
      data-client-compatibility-notice="generic"
      data-client-notice-reason={reason}
      role={alert ? 'alert' : undefined}
      aria-live={alert ? 'assertive' : undefined}
    >
      {service ? (
        <BrandedState
          eyebrow={t('client_notice.service.eyebrow', locale)}
          title={t('client_notice.service.title', locale)}
          description={t('client_notice.service.body', locale)}
        >
          <div className={pairClass}>
            <a href={retryHref} className={`${primaryButtonClass} sm:order-2`}>
              {t('client_notice.try_again', locale)}
            </a>
            <a href="tel:0982565628" className={`${secondaryButtonClass} sm:order-1`}>
              {locale === 'th' ? 'โทร' : 'Call'} <span className="mangmee-unit">098-256-5628</span>
            </a>
          </div>
        </BrandedState>
      ) : (
        <BrandedState
          eyebrow={t('client_notice.eyebrow', 'th')}
          title={t('client_notice.title', 'th')}
          description={t('client_notice.body', 'th')}
        >
          <p className="w-full basis-full text-sm leading-6 text-gray-500">
            <span className="font-semibold text-gray-700">{t('client_notice.title', 'en')}.</span>{' '}
            {t('client_notice.body', 'en')}
          </p>
          <div className={stackClass}>
            <a href={retryHref} className={primaryButtonClass}>
              {t('client_notice.try_again', 'th')} / {t('client_notice.try_again', 'en')}
            </a>
            <a href="mailto:contact@mangmeeplus.com" className={secondaryButtonClass}>
              {t('client_notice.contact', 'th')} / {t('client_notice.contact', 'en')}
            </a>
          </div>
        </BrandedState>
      )}
    </div>
  );
}
