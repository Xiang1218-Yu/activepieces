import dayjs from 'dayjs';
import advancedFormat from 'dayjs/plugin/advancedFormat';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(advancedFormat);

export const triggerCalendarTimeUtils = {
  formatInZone(isoTime: string, timeZone: string, withSeconds = false): string {
    return dayjs
      .utc(isoTime)
      .tz(timeZone)
      .format(withSeconds ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD HH:mm');
  },
  weekdayInZone(isoTime: string, timeZone: string): string {
    return dayjs.utc(isoTime).tz(timeZone).format('ddd');
  },
  dayKeyInZone(isoTime: string, timeZone: string): string {
    return dayjs.utc(isoTime).tz(timeZone).format('YYYY-MM-DD');
  },
  dayLabelInZone(isoTime: string, timeZone: string): string {
    return dayjs.utc(isoTime).tz(timeZone).format('ddd, MMM D');
  },
  windowLabel(isoTime: string): string {
    return dayjs.utc(isoTime).format('MMM D, YYYY HH:mm') + ' UTC';
  },
  formatOffset(utcOffsetMinutes: number): string {
    const sign = utcOffsetMinutes >= 0 ? '+' : '-';
    const abs = Math.abs(utcOffsetMinutes);
    const hours = String(Math.floor(abs / 60)).padStart(2, '0');
    const minutes = String(abs % 60).padStart(2, '0');
    return `UTC${sign}${hours}:${minutes}`;
  },
};
