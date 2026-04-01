export type CommandResult<T> = {
  isSuccess: boolean;
  result: T;
};

export const success = <T>(result: T): CommandResult<T> => ({
  isSuccess: true,
  result,
});

export const failure = <T>(result: T): CommandResult<T> => ({
  isSuccess: false,
  result,
});
