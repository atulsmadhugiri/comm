// @flow

import type {
  CodeVerificationRequest,
  HandleVerificationCodeResult,
} from 'lib/types/verify-types';
import type { Viewer } from '../session/viewer';

import t from 'tcomb';

import { ServerError } from 'lib/utils/fetch-utils';
import { verifyField } from 'lib/types/verify-types';

import { validateInput, tShape } from '../utils/validation-utils';
import { handleCodeVerificationRequest } from '../models/verification';
import { pool, SQL } from '../database';

const codeVerificationRequestInputValidator = tShape({
  code: t.String,
});

async function codeVerificationResponder(
  viewer: Viewer,
  input: any,
): Promise<HandleVerificationCodeResult> {
  const request: CodeVerificationRequest = input;
  validateInput(codeVerificationRequestInputValidator, request);

  const result = await handleCodeVerificationRequest(request.code);
  if (!result) {
    throw new ServerError('unhandled_field');
  }
  if (result.field === verifyField.EMAIL) {
    return { verifyField: result.field };
  } else if (result.field === verifyField.RESET_PASSWORD) {
    return {
      verifyField: result.field,
      resetPasswordUsername: result.resetPasswordUsername,
    };
  }
  throw new ServerError('unhandled_field');
}

export {
  codeVerificationResponder,
};
