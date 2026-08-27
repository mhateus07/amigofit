import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const REMINDER_IDENTIFIER = 'amigofit-workout-reminder';
const CHANNEL_ID = 'workout-reminders';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Lembretes de treino',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export async function requestReminderPermission(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return true;
  const { status: requested } = await Notifications.requestPermissionsAsync();
  return requested === 'granted';
}

/** Agenda o lembrete diário no horário informado ('HH:mm'), substituindo o anterior. */
export async function scheduleWorkoutReminder(time: string): Promise<{ ok: boolean; error?: string }> {
  const granted = await requestReminderPermission();
  if (!granted) {
    return { ok: false, error: 'Permissão de notificações negada. Ative em Ajustes > AmigoFit > Notificações.' };
  }

  const [hour, minute] = time.split(':').map(n => parseInt(n, 10));
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    return { ok: false, error: 'Horário inválido.' };
  }

  await ensureAndroidChannel();
  await Notifications.cancelScheduledNotificationAsync(REMINDER_IDENTIFIER).catch(() => {});

  await Notifications.scheduleNotificationAsync({
    identifier: REMINDER_IDENTIFIER,
    content: {
      title: 'Bora treinar? 💪',
      body: 'Conta pro AmigoFit como foi seu dia — treino, refeições ou como você tá se sentindo.',
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
      channelId: CHANNEL_ID,
    },
  });

  return { ok: true };
}

export async function cancelWorkoutReminder(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(REMINDER_IDENTIFIER).catch(() => {});
}
