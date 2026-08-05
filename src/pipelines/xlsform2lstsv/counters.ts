/**
 * Shared sequence counters for Q/SQ/A/G naming. Several emitters
 * (GroupEmitter, MatrixHandler, AnswerEmitter) all reach into the
 * same numbers to disambiguate auto-generated names like G1, SQ0,
 * A0 — so they must share one source of truth.
 */
export class Counters {
  groupSeq = 0;
  questionSeq = 0;
  answerSeq = 0;
  subquestionSeq = 0;

  clear(): void {
    this.groupSeq = 0;
    this.questionSeq = 0;
    this.answerSeq = 0;
    this.subquestionSeq = 0;
  }

  setAnswerSeq(value: number): void {
    this.answerSeq = value;
  }

  bumpAnswerSeq(): number {
    return ++this.answerSeq;
  }

  getAnswerSeq(): number {
    return this.answerSeq;
  }

  // Getters / setters used by the matrix counters interface.
  getGroupSeq(): number {
    return this.groupSeq;
  }

  bumpGroupSeq(): number {
    return ++this.groupSeq;
  }

  getQuestionSeq(): number {
    return this.questionSeq;
  }

  bumpQuestionSeq(): number {
    return ++this.questionSeq;
  }

  getSubquestionSeq(): number {
    return this.subquestionSeq;
  }

  setSubquestionSeq(value: number): void {
    this.subquestionSeq = value;
  }

  bumpSubquestionSeq(): number {
    return ++this.subquestionSeq;
  }
}
