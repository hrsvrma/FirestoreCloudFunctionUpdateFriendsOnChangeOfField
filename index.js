const moment = require('moment');
const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Global constants
const COLLECTION_NAME = 'informations';
const FIELD_FRIENDS = 'Friend';
const FIELD_NUMBER = 'number';
const FIELD_NUMBER_LAST_UPDATED_AT = 'numberLastUpdatedAt';

// Global variables
let isAppInitialized = false;
let db;
let informationsRef;

exports.onUpdateInformation = functions.firestore
  .document(`${COLLECTION_NAME}/{userId}`)
  .onUpdate((change, context) => {
    const newValue = change.after.data();
    const previousValue = change.before.data();

    if(newValue[FIELD_NUMBER] === previousValue[FIELD_NUMBER]) {
      // console.log(`No change in number (eventId: ${context.eventId})`);
      return Promise.resolve();
    }
    console.log(`Event context: ${JSON.stringify(context)}`);
    console.log(`user ${context.params.userId} changed number from ${previousValue[FIELD_NUMBER]} to ${newValue[FIELD_NUMBER]} (eventId: ${context.eventId})`);
    return processOnUpdateEvent(change, context);
});

/**
 * processes update event on field 'number' of document
 * @param {*} change
 * @param {*} context
 */
async function processOnUpdateEvent(change, context) {
  if(!isAppInitialized) {
    // Lazy initialization for faster execution of noop events
    admin.initializeApp();
    db = admin.firestore();
    informationsRef = db.collection(COLLECTION_NAME);
    isAppInitialized = true;
  }

  const userRef = informationsRef.doc(context.params.userId);

  await db.runTransaction(async transaction => {
    const userSnaphot = await transaction.get(userRef);
    if(userSnaphot.data()[FIELD_NUMBER] !== change.after.data()[FIELD_NUMBER] ||
      moment(userSnaphot.data()[FIELD_NUMBER_LAST_UPDATED_AT] || 1).isAfter(context.timestamp)) {
      console.log(`Skip processing this obsolete event (eventId: ${context.eventId})`);
      return;
    }

    const [previousFriends, newFriends] = await Promise.all([
      transaction.get(informationsRef.where(FIELD_NUMBER, '==', change.before.data()[FIELD_NUMBER])),
      transaction.get(informationsRef.where(FIELD_NUMBER, '==', change.after.data()[FIELD_NUMBER]))
    ]);

    const tasks = [
      transaction.update(userRef, {
        [FIELD_NUMBER_LAST_UPDATED_AT]: context.timestamp,
        [FIELD_FRIENDS]: newFriends.docs.filter(doc => doc.id !== context.params.userId).map(doc => doc.id)
      })
    ];

    previousFriends.forEach(doc => {
      tasks.push(transaction.update(informationsRef.doc(doc.id), {
        [FIELD_FRIENDS]: admin.firestore.FieldValue.arrayRemove(context.params.userId)
      }));
    });

    newFriends.forEach(doc => {
      if(doc.id === context.params.userId) return;
      tasks.push(transaction.update(informationsRef.doc(doc.id), {
        [FIELD_FRIENDS]: admin.firestore.FieldValue.arrayUnion(context.params.userId)
      }));
    });

    await Promise.all(tasks);
  });
}