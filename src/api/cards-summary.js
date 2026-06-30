import { getCards } from '../events/_start.js';

export default (req, res) => {
    return getCards();
};
