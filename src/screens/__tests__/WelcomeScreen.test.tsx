import React from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react-native';
import WelcomeScreen from '../WelcomeScreen';

describe('WelcomeScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(async () => {
    await cleanup();
    jest.useRealTimers();
  });

  it('renderiza o headline e aciona os callbacks de login/registro', async () => {
    const onLogin = jest.fn();
    const onRegister = jest.fn();

    const { getByText } = await render(
      <WelcomeScreen onLogin={onLogin} onRegister={onRegister} />
    );

    expect(getByText('AmigoFit')).toBeTruthy();

    fireEvent.press(getByText('Começar agora — é grátis 💪'));
    expect(onRegister).toHaveBeenCalledTimes(1);

    fireEvent.press(getByText('Já tenho uma conta  →'));
    expect(onLogin).toHaveBeenCalledTimes(1);
  });
});
