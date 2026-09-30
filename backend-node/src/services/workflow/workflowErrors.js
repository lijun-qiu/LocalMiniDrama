'use strict';

class WorkflowRequestError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'WorkflowRequestError';
    if (code) this.code = code;
  }
}

module.exports = { WorkflowRequestError };
